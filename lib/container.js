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

var Container = function(options) {
	events.EventEmitter.call(this);
	var self = this;
	this.options = options;

	this.docker = options.docker;
	this.config = options.config;
	this.container = null;
	this.id = null;
	this.images = {};
	this.info = {};
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

	var logs = Logger.createLogger(this.options.logs);

	this.std = logs.create({
		source : options.source,
		channel : options.channel,
		session : options.logSession,
		//	bufferSize : 1
	});
	this.stdSystem = logs.create({
		source : 'system',
		channel : options.channel,
		session : options.logSession,
		//bufferSize : 1
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
						return callback(new Error('Aplication crashed within 1500ms of starting'));
					}

					self._info(function(err) {
						if (err)
							return callback(err);

						self._detectPort(function(error) {
							self.state = 2;
							if (error) {
								self.stop(true, function(err) {
									if (err)
										return callback(err);
									callback(error);
								});
							} else {
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
		return;
	}
	this.state = 3;

	this._stop(function(err) {
		if (clean) {
			self._clean(function() {

			});
		}
		self.std.stop(function() {
			self.stdSystem.stop(function() {
				self.emit('stop');
				callback();
			});
		});
	});
};
Container.prototype.top = function(cb) {
	debug('Container.top Top called on ' + this.id)
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
Container.prototype.pause = function() {
	//
};
Container.prototype.resume = function() {
	//
};
Container.prototype._info = function(callback) {
	debug('Container.info Info called on ' + this.id)
	var self = this;
	this.container.inspect(function(err, inspect) {
		if (err) {
			var error = new Error('Container.info.inspect');
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}
		self.info = {
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

		var ip = self._ipAddress();

		Object.keys(inspect.NetworkSettings.Ports).forEach(function(key) {
			if (inspect.NetworkSettings.Ports[key])
				inspect.NetworkSettings.Ports[key].forEach(function(item) {
					self.info.ports.push({
						forward : key,
						port : item.HostPort,
						ip : item.HostIp
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

	var self = this;

	async.parallel(this.info.ports.map(function(item) {
		return function(next) {
			self._detectPortReady(item.port, item.ip, next);
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
	debug('Container._ipAddress')
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
	debug('Container._createContainer Creating Container ' + this.config.Image)
	var self = this;
	this.docker.createContainer(this.config, function(err, container) {
		if (err) {
			if (err.reason == 'no such container') {
				return self._pull(function(err) {
					if (err)
						return callback(err);
					self._createContainer(callback);
				});
			}
			var error = new Error('Container._createContainer ' + err.json);
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}
		self.container = container;
		callback(null, container);
	});
};
Container.prototype._attach = function(callback) {
	debug('Container._attach Attaching to logs ' + this.id)
	var self = this;
	this.container.attach({
		stream : true,
		stdout : true,
		stderr : true
	}, function(err, stream) {
		if (err) {
			var error = new Error('Container._attach.attach');
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}
		self.container.modem.demuxStream(stream, self.std, self.std);
		callback();
	});
};
Container.prototype._clean = function(callback) {
	debug('Container._clean Cleaning old images ' + this.id);
	var self = this;
	this.container.remove(function(err, data) {
		if (err) {
			var error = new Error('Container._clean.remove');
			error.err = err;
			self.emit('error', error);
		}

		callback();

	});
};
Container.prototype._top = function(callback) {
	debug('Container._top Calling RAW top on ' + this.id)
	var self = this;
	this.container.top({
		ps_args : 'aux'
	}, function(err, data) {
		if (err) {
			var error = new Error('Container._top.top');
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}
		callback(null, data);
	});
};
Container.prototype._start = function(callback) {
	debug('Container._start Calling RAW start on ' + this.id)
	var self = this;
	this.container.start(function(err, data) {
		if (err) {
			var error = new Error('Container._start.start');
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}
		self._wait();
		self._attach(function(err) {
			if (err) {
				var error = new Error('Container._start.start');
				error.err = err;
				self.emit('error', error);
				return callback(error);
			}

			setTimeout(function() {

				callback(null, data);
			}, 1000)

		});
	});
};
Container.prototype._wait = function() {
	debug('Container._wait Calling RAW wait on ' + this.id)
	var self = this;
	this.container.wait(function(err, data) {
		if (err) {
			var error = new Error('Container._wait.wait');
			error.err = err;
			self.emit('error', error);
			return callback(error);
		}

		if (self.state == 'STOPPING') {
			self.state = 4;
		} else {
			self.exitReason = 'CRASHED';

			self._clean(function() {

			});
			self.state = 5;
		}

		self.emit('wait', data);

		self.stdSystem.log('Exit code: ' + data.StatusCode);

	});
};
Container.prototype._pull = function(callback) {
	debug('Container._pull CAlling pull on ' + this.config.Image)
	var self = this;

	this.docker.pull(this.config.Image, function(err, stream) {
		if (err) {
			var error = new Error('Container._pull.pull');
			error.err = err;
			self.emit('error', error);
			return callback(error);
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
				return callback(new Error(json.error));
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
	this.container.stop(function(err, data) {
		if (err) {
			var error = new Error('Container._stop.stop');
			error.err = err;
			self.emit('error', error);
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
		attempts += 1;
		if (err) {
			if (attempts > 60) {
				if (called) {
					return;
				}
				called = true
				callback(new Error('App not listing on required port'));
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
