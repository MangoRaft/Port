var util = require('util');
var fs = require('fs');
var path = require('path');
var events = require('events');
var os = require('os');
var net = require('net');
var Socket = net.Socket;
var async = require('async');
var Logger = require('raft-logger-redis').Logger;
var debug = require('debug')('container');

var ContainerError = require('./error').ContainerError;

var Container = function(options) {
	events.EventEmitter.call(this);
	var self = this;
	this.options = options;

	this.docker = options.docker;
	this.address = options.address;
	this.dockerHost = this.address ? this.address : options.docker.modem.socketPath ? '127.0.0.1' : options.docker.modem.host;
	this.config = options.config;
	this.auth = options.auth;
	this.container = null;
	this.id = null;
	this.images = {};
	this.statsStream = null;
	this._stats = null;
	this.exitReason = null;

	var state = 0;
	this.__defineGetter__("state", function() {
		return self.states[state];
	});
	this.__defineSetter__("state", function(val) {
		self.stdSystem.log('State changed from: ' + self.states[state] + ' to: ' + self.states[val]);
		state = val;
		this.info.state = self.states[state];
		self.emit(self.states[state]);
	});

	this.info = {
		ports : [],
		env : {},
		image : self.options.config.Image,
		logs : self.options.logs,
		logSession : self.options.logSession,
		name : self.options.name,
		index : self.options.index,
		uid : self.options.uid,
		id : self.id,
		state : self.state
	};
	var logs = Logger.createLogger(this.options.logs);

	this.std = logs.create({
		source : options.source,
		channel : options.channel,
		session : options.logSession,
		bufferSize : 5
	});
	this.stdSystem = logs.create({
		source : 'system',
		channel : options.channel,
		session : options.logSession,
		bufferSize : 5
	});

	this.std.start();
	this.stdSystem.start();
};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Container, events.EventEmitter);

Container.prototype.states = ['INITIALIZING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'CRASHED', 'DELETED'];

Container.prototype.start = function(callback) {
	debug('Container.start Starting image: ' + this.config.Image);
	var self = this;
	//if (!this.container) {
	this.state = 1;
	self._pull(function(err) {
		if (err)
			return callback(err);
		self._createContainer(function(err, container) {
			if (err)
				return callback(err);

			self.id = container.id;

			self._start(function(err) {
				if (err)
					return callback(err);

				setTimeout(function() {
					if (self.state == 'CRASHED') {

						var err = new ContainerError('C1');
						self.emit('error', err);
						return callback(err);
					}
					if (self.options.stats)
						self.stats();
					self._info(function(err) {
						if (err)
							return callback(err);
						if (self.state == 'CRASHED') {

							var err = new ContainerError('C2');
							self.emit('error', err);
							return callback(err);
						}
						self._detectPort(function(error) {

							if (error) {
								self.stop(true, function(err) {
									if (err)
										return callback(err);
									callback(error);
								});
							} else {
								self.state = 2;
								callback(null, container);
							}
						});
					});
				}, 1500);
			});
		});
	});
	//}
};
Container.prototype.stop = function(clean, callback) {
	debug('Container.stop Stopping container: ' + this.id);
	var self = this;
	if (['STOPPING', 'STOPPED', 'CRASHED', 'DELETED'].indexOf(this.state) !== -1) {
		return callback();
	}
	this.state = 3;

	this._stop(function(err) {
		if (clean) {
			self._clean(function() {
				self.std.stop(function() {
					self.stdSystem.stop(function() {
						self.emit('stop');
						callback();
					});
				});
			});
		} else {
			self.std.stop(function() {
				self.stdSystem.stop(function() {
					self.emit('stop');
					callback();
				});
			});
		}
	});
};
Container.prototype.top = function(cb) {
	debug('Container.top Top called on ' + this.id);
	var self = this;

	this._top(function(err, data) {
		var top = [];
		data.Processes.forEach(function(processe) {
			var a = {};
			processe.forEach(function(item, index) {
				a[data.Titles[index]] = item;
			});
			top.push(a);
		});
		cb(null, top);
	});
};
Container.prototype.stats = function() {
	debug('Container.stats Stats called on ' + this.id);
	var self = this;
	this.container.stats({
		stream : true
	}, function(error, stream) {
		if (error) {

			var err = new ContainerError('C3', error.reason);
			err.code = 'C3';
			self.emit('error', err);
			return;
		}
		self.statsStream = stream;
		function onData(data) {
			try {
				var json = JSON.parse(data.toString());
			} catch(err) {
				return console.log(err);
			}

			self.emit('stats', json);
		}


		stream.on('data', onData);
	});
};
Container.prototype.pause = function() {
	//
};
Container.prototype.resume = function() {
	//
};
Container.prototype._info = function(callback) {
	debug('Container.info Info called on ' + this.id);
	var self = this;
	this.container.inspect(function(error, inspect) {
		if (error) {

			var err = new ContainerError('C4', error.reason);
			self.emit('error', err);
			return callback(err);
		}

		var ip = self._ipAddress();
		if (inspect.NetworkSettings.Ports)
			Object.keys(inspect.NetworkSettings.Ports).forEach(function(key) {
				if (inspect.NetworkSettings.Ports[key])
					inspect.NetworkSettings.Ports[key].forEach(function(item) {
						self.info.ports.push({
							forward : key,
							port : item.HostPort,
							ip : self.dockerHost
						});
					});
			});

		inspect.Config.Env.forEach(function(env) {
			env = env.split('=');
			self.info.env[env.shift()] = env.join('=');
		});

		callback(null, self.info);
	});
};
/**
 *
 */

Container.prototype._detectPort = function(callback) {
	debug('Container._detectPort Building ports to detect');

	if (this.options.process !== 'web') {
		return callback();
	}

	var self = this;

	async.parallel(this.info.ports.map(function(item) {
		return function(next) {
			self._detectPortReady(item.port, self.dockerHost, next);
		};
	}), function(err) {
		if (err) {

			if (Array.isArray(err)) {
				callback(err[0]);
			} else {
				callback(err);
			}
		} else {
			callback();
		}
	});
};

Container.prototype._ipAddress = function() {
	debug('Container._ipAddress');
	var interfaces = os.networkInterfaces();
	var addresses = Object.keys(interfaces).map(function(nic) {
		var addrs = interfaces[nic].filter(function(details) {
			return details.address !== '127.0.0.1' && details.family === 'IPv4';
		});
		return addrs.length ? addrs[0].address : undefined;
	}).filter(Boolean);
	return addresses.length ? addresses[0] : '127.0.0.1';
};

Container.prototype._createContainer = function(callback) {
	debug('Container._createContainer Creating Container ' + this.config.Image);
	var self = this;
	this.docker.createContainer(this.config, function(error, container) {
		if (error) {
			if (error.reason == 'no such container') {
				return self._pull(function(err) {
					if (err)
						return callback(err);
					self._createContainer(callback);
				});
			}
			var err = new ContainerError('C5', error.reason);

			self.emit('error', err);
			return callback(err);
		}
		self.info.id = container.id;

		self.container = container;
		callback(null, container);
	});
};
Container.prototype._attach = function(callback) {
	debug('Container._attach Attaching to logs ' + this.id);
	var self = this;
	this.container.attach({
		stream : true,
		stdout : true,
		stderr : true,
		logs : true
	}, function(error, stream) {
		if (error) {
			var err = new ContainerError('C6', error.reason);
			self.emit('error', err);
			return callback(err);
		}
		self.container.modem.demuxStream(stream, self.std, self.std);
		callback();
	});
};
Container.prototype._clean = function(callback) {
	debug('Container._clean Cleaning old images ' + this.id);
	var self = this;
	this.container.remove({
		v : true
	}, function(error, data) {
		if (error) {
			var err = new ContainerError('C7', error.reason);
			self.emit('error', err);
		}
		self.docker.getImage(self.config.Image).remove(function(err) {
			callback();
		});

	});
};
Container.prototype._top = function(callback) {
	debug('Container._top Calling RAW top on ' + this.id);
	var self = this;
	this.container.top({
		ps_args : 'aux'
	}, function(error, data) {
		if (error) {
			var err = new ContainerError('C8', error.reason);
			self.emit('error', err);
			return callback(err);
		}
		callback(null, data);
	});
};
Container.prototype._start = function(callback) {
	debug('Container._start Calling RAW start on ' + this.id);
	var self = this;
	this.container.start(function(error, data) {
		if (error) {
			var err = new ContainerError('C9', error.reason);
			self.emit('error', err);
			if (err.reason == 'no such container') {
				return self._clean(function() {
					callback(err);
				});
			}
			return callback(err);
		}
		self._wait();
		self._attach(function(err) {
			if (err) {
				return callback(error);
			}

			setTimeout(function() {

				callback(null, data);
			}, 1000);

		});
	});
};
Container.prototype._wait = function() {
	debug('Container._wait Calling RAW wait on ' + this.id)
	var self = this;
	this.container.wait(function(error, data) {
		if (error) {

			var err = new ContainerError('C10', error.reason);
			self.emit('error', err);
			return callback(err);
		}

		if (self.state == 'STOPPING') {
			self.state = 4;
		} else {
			self.exitReason = 'CRASHED';

			self._clean(function() {
				self.std.stop(function() {
					self.stdSystem.stop(function() {

						self.state = 5;
					});
				});

			});
		}

		self.emit('wait', data);

		self.stdSystem.log('Exit code: ' + data.StatusCode);

	});
};
Container.prototype._pull = function(callback) {
	debug('Container._pull CAlling pull on ' + this.config.Image)
	var self = this;

	this.docker.pull(this.config.Image, {
		'authconfig' : this.config.auth
	}, function(error, stream) {
		if (error) {
			var err = new ContainerError('C11', error.reason);
			self.emit('error', err);
			return callback(err);
		}

		function onData(data) {
			try {
				var json = JSON.parse(data.toString());
			} catch(err) {
				return console.log(err);
			}

			if (json.error) {
				stream.removeListener('data', onData);
				stream.removeListener('end', callback);

				var err = new ContainerError('C12', json.error && json.error.reason);
				self.emit('error', err);
				return callback(err);
			}
			self.images[json.id] = true;
		}


		stream.on('data', onData);
		stream.on('end', callback);
	});
};
Container.prototype._stop = function(callback) {
	debug('Container._stop Calling RAW stop on ' + this.id);
	var self = this;

	if (!this.container)
		return self.emit('_stop');
	if (this.statsStream) {
		this.statsStream.destroy();
		this.statsStream = null;
	}
	this.container.stop({
		t : 10
	}, function(error, data) {
		if (error) {

			var err = new ContainerError('C13', error.reason);
			self.emit('error', err);
		}
		callback(null, data);
	});
};

Container.prototype._detectPortReady = function(port, host, callback) {

	debug('Container._detectPortReady Stating detect on port ' + port + ' host ' + host + ' for ' + this.id);
	var self = this;
	var called = false;
	var attempts = 0;
	function attempt(cb) {
		debug('Container._detectPortReady attempt: ' + attempts + ' on port ' + port + ' host ' + host + ' for ' + self.id);
		var socket = new Socket();
		socket.on('connect', function() {
			cb();
			socket.end();
		});
		socket.setTimeout(400);
		socket.on('timeout', function() {
			cb(true);

			socket.destroy();
		});
		socket.on('error', function(exception) {
			cb(true);
		});
		socket.connect(port, host);
	}

	var loop = function(err) {
		if (self.state == 'STOPPING' || self.state == 'STOPPED' || self.state == 'CRASHED') {
			var err = new ContainerError('C14');
			self.emit('error', err);
			return callback(err);
		}
		attempts += 1;
		if (err) {
			if (attempts > 60) {
				if (called) {
					return;
				}
				called = true;
				var err = new ContainerError('C15', err.reason);
				self.emit('error', err);
				callback(err);
			} else {
				setTimeout(function() {
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
};

module.exports = Container;
