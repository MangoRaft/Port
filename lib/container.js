const events = require('events');
const os = require('os');
const async = require('async');
const readline = require('readline');
const net = require('net');
const Socket = net.Socket;

const Logger = require('raft-logger-redis').Logger;


const debug = require('debug')('container');

const ContainerError = require('./error').ContainerError;
const Exec = require('./exec');

const to = require('./to');

class Container extends events.EventEmitter {
    constructor(options) {
        super(options);

        this.options = options;

        this.docker = options.docker;
        this.address = options.address;
        this.dockerHost = this.address ? this.address : options.docker.modem.socketPath ? '127.0.0.1' : options.docker.modem.host;
        this.config = options.config;
        this.auth = options.auth;
        this.shortLived = options.shortLived;

        this.resource = options.resource;
        this.volume = options.volume;
        this.env = options.env;
        this.exclude = options.exclude || [];

        this.container = null;
        this.id = null;
        this.images = {};
        this.statsStream = null;
        this._stats = null;
        this.exitReason = null;

        this.states = [
            'INITIALIZING',
            'STARTING',
            'RUNNING',
            'STOPPING',
            'STOPPED',
            'CRASHED',
            'DELETED'
        ];
        this._state = 0;


        this.info = {
            ports: [],
            env: {},
            statusCode: null,
            image: options.config.Image,
            logs: options.logs,
            logSession: options.logSession,
            name: options.name,
            index: options.index,
            uid: options.uid,
            id: this.id,
            state: this.state
        };
        let logs = Logger.createLogger(options.logs);

        this.std = logs.create({
            source: options.source,
            channel: options.channel,
            session: options.logSession,
            bufferSize: 1
        });
        this.stdSystem = logs.create({
            source: 'system',
            channel: options.channel,
            session: options.logSession,
            bufferSize: 1
        });

        this.std.start();
        this.stdSystem.start();


    }

    get state() {
        return this.states[this._state];
    }

    set state(val) {
        this.stdSystem.log('State changed from: ' + this.states[this._state] + ' to: ' + this.states[val]);
        this._state = val;
        this.info.state = this.states[this._state];
        this.emit(this.states[this._state]);
    }

    start() {
        let self = this;
        this.state = 1;
        return new Promise(async function (resolve, reject) {

            let err,
                container;

            [err] = await to(self.pull());
            if (err) {
                return reject(err)
            }
            [err, container] = await to(self.createContainer());
            if (err) {
                return reject(err)
            }

            self.id = container.id;

            [err] = await to(self._start());
            if (err) {
                return reject(err)
            }

            if (self.state === 'CRASHED') {
                return reject(self.error('C1'));
            }

            if (self.options.stats)
                self.stats();


            [err] = await to(self._info());
            if (err) {
                return reject(err);
            } else if (self.state === 'CRASHED') {
                return reject(self.error('C2'));
            }

            [err] = await to(self.detectPort());
            if (err) {
                try {
                    await self.stop(true);
                } catch (err) {

                    return reject(err);
                }
                return reject(err);
            }
            [err] = await to(self.update());
            if (err) {
                try {
                    await self.stop(true);
                } catch (err) {

                    return reject(err);
                }
                return reject(err);
            }

            self.state = 2;
            resolve(container)
        })
    }

    async stop(clean) {
        debug('Container.stop Stopping container: ' + this.id);

        if (['STOPPING', 'STOPPED', 'CRASHED', 'DELETED'].indexOf(this.state) !== -1) {
            return Promise.resolve();
        }

        let self = this,
            err;

        this.state = 3;

        [err] = await to(self._stop());
        if (err) {
            return Promise.reject(err)
        }

        if (clean) {
            try {
                await this.clean()
            } catch (err) {
                return Promise.reject(err)
            }
        }

        this.std.stop()
        this.stdSystem.stop()
        this.emit('stop');

        return Promise.resolve()

    }

    async _stop() {

        debug('Container._stop Calling RAW stop on ' + this.id);

        if (!this.container)
            return this.emit('_stop');
        if (this.statsStream) {
            this.statsStream.destroy();
            this.statsStream = null;
        }

        let [err, data] = await to(this.container.stop({
            t: 10
        }));
        if (err) {
            this.error('C13', err)
        }

        return Promise.resolve(data)

    }

    async clean() {
        debug('Container._clean Cleaning old images ' + this.id);

        let [err, data] = await to(this.container.remove({
            v: true
        }));
        if (err) {
            this.error('C7', err)
        }
        if (this.exclude.indexOf(this.config.Image) !== -1) {
            return Promise.resolve()
        }

        try {
            await this.docker.getImage(this.config.Image).remove();
        } catch (e) {

        }
        return Promise.resolve()
    }

    async update() {
        return this.container.update(this.resource.update());
    }

    async pull() {
        debug('Container._pull Calling pull on ' + this.config.Image);

        let self = this;

        let [err, stream] = await to(this.docker.pull(this.config.Image, {
            'authconfig': this.config.auth
        }));
        if (err) {
            return Promise.reject(this.error('C7', err))
        }

        return new Promise(function (resolve, reject) {
            function onData(data) {
                let json;
                try {
                    json = JSON.parse(data.toString());
                } catch (err) {
                    return console.log(err);
                }

                if (json.error) {
                    stream.removeListener('data', onData);
                    stream.removeListener('end', resolve);

                    return reject(this.error('C12', json.error));
                }
                self.images[json.id] = true;
            }


            stream.on('data', onData);
            stream.once('end', resolve);
        })
    }

    async createContainer() {
        debug('Container._createContainer Creating Container ' + this.config.Image);

        let [err, container] = await to(this.docker.createContainer(this.config));
        if (err) {
            if (err.reason === 'no such container') {
                try {
                    await this.pull();
                } catch (err) {
                    return Promise.reject(err)
                }
            } else {
                return Promise.reject(this.error('C5', err));
            }
        }

        this.info.id = container.id;
        this.container = container;

        return Promise.resolve(container)
    }

    async _start() {
        debug('Container._start Calling RAW start on ' + this.id);

        let [err, data] = await to(this.container.start());
        if (err) {

            err = this.error('C9', err);


            if (err.reason === 'no such container') {
                try {
                    await this.clean()
                } catch (e) {

                }
            }
            return Promise.reject(err);
        }
        this.wait();
        try {
            await this.attach()
        } catch (err) {
            console.log(err)
            this.emit('error', err);
            return Promise.reject(err)
        }

        return Promise.resolve(data)
    }

    wait() {
        debug('Container._wait Calling RAW wait on ' + this.id);
        let self = this;
        this.container.wait(async function (err, data) {
            if (err) {
                return self.error('C10', err)
            }

            self.info.statusCode = data.StatusCode;


            self.emit('wait', data);
            self.stdSystem.log('Exit code: ' + data.StatusCode);
            if (self.state === 'STOPPING') {
                self.state = 4;
            } else if (self.shortLived && data.StatusCode === 0) {
                self.state = 3;
                await self.clean();
                self.state = 4;
                self.std.stop();
                self.stdSystem.stop();
            } else {
                self.exitReason = 'CRASHED';
                await self.clean();
                self.std.stop();
                self.stdSystem.stop();
                self.state = 5;
            }

        });
    }

    async attach() {
        debug('Container._attach Attaching to logs ' + this.id);

        let [err, stream] = await to(this.container.attach({
            stream: true,
            stdout: true,
            stderr: true,
            logs: true
        }));
        if (err) {
            return Promise.reject(this.error('C6', err));
        }
        this.container.modem.demuxStream(stream, this.std, this.std);
        return Promise.resolve()
    }

    stats() {
        debug('Container.stats Stats called on ' + this.id);
        let self = this;
        this.container.stats({
            stream: true
        }, function (err, stream) {
            if (err) {
                self.error('C3', err);
                return;
            }
            self.statsStream = stream;
            let rl = readline.createInterface({
                input: stream
            });

            rl.on('line', function (line) {
                let json;
                try {
                    json = JSON.parse(line);
                } catch (err) {
                    return console.log(line);
                }
                self.emit('stats', json);
            });
        });
    }

    async _info() {
        debug('Container.info Info called on ' + this.id);

        let [err, inspect] = await to(this.container.inspect());
        if (err) {
            return Promise.reject(this.error('C4', err));
        }

        let self = this;

        let ip = self.ipAddress();
        if (inspect.NetworkSettings.Ports)
            Object.keys(inspect.NetworkSettings.Ports).forEach(function (key) {
                if (inspect.NetworkSettings.Ports[key])
                    inspect.NetworkSettings.Ports[key].forEach(function (item) {
                        self.info.ports.push({
                            forward: key,
                            port: item.HostPort,
                            ip: self.dockerHost
                        });
                    });
            });

        inspect.Config.Env.forEach(function (env) {
            env = env.split('=');
            self.info.env[env.shift()] = env.join('=');
        });
        return Promise.resolve(self.info)
    }

    detectPort() {
        debug('Container._detectPort Building ports to detect');

        if (this.options.process !== 'web') {
            return Promise.resolve();
        }

        let self = this;
        return new Promise(function (resolve, reject) {

            async.parallel(self.info.ports.map(function (item) {
                return function (next) {
                    self._detectPortReady(item.port, self.dockerHost, next);
                };
            }), function (err) {
                if (err) {
                    if (Array.isArray(err)) {
                        reject(err[0]);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve();
                }
            });
        })
    }

    _detectPortReady(port, host, callback) {
        debug('Container._detectPortReady Stating detect on port ' + port + ' host ' + host + ' for ' + this.id);
        var self = this;
        var called = false;
        var attempts = 0;

        function attempt(cb) {
            debug('Container._detectPortReady attempt: ' + attempts + ' on port ' + port + ' host ' + host + ' for ' + self.id);
            var socket = new Socket();
            socket.on('connect', function () {
                cb();
                socket.end();
            });
            socket.setTimeout(400);
            socket.on('timeout', function () {
                cb(true);

                socket.destroy();
            });
            socket.on('error', function (exception) {
                cb(true);
            });
            socket.connect(port, host);
        }

        var loop = function (err) {
            if (self.state === 'STOPPING' || self.state === 'STOPPED' || self.state === 'CRASHED') {
                return callback(self.error('C14'));
            }
            attempts += 1;
            if (err) {
                if (attempts > 120) {
                    if (called) {
                        return;
                    }
                    called = true;
                    callback(self.error('C15', err));
                } else {
                    setTimeout(function () {
                        attempt(loop);
                    }, 1000);
                }
            } else {
                if (called) {
                    return;
                }
                called = true;
                callback();
            }
        };
        attempt(loop);
    }

    ipAddress() {
        debug('Container._ipAddress');
        var interfaces = os.networkInterfaces();
        var addresses = Object.keys(interfaces).map(function (nic) {
            var addrs = interfaces[nic].filter(function (details) {
                return details.address !== '127.0.0.1' && details.family === 'IPv4';
            });
            return addrs.length ? addrs[0].address : undefined;
        }).filter(Boolean);
        return addresses.length ? addresses[0] : '127.0.0.1';
    }

    error(code, error) {
        let err = new ContainerError(code, error && (error.reason || error.message));
        console.log(code, error)
        this.emit('error', err)


        return err
    }
}

module.exports = Container;