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
var Exec = require('./exec');

var Container = function(options) {
	events.EventEmitter.call(this);
	var self = this;
	this.options = options;

	this.docker = options.docker;
	this.address = options.address;
	this.baseImage = options.baseImage;
	this.dockerHost = this.address ? this.address : options.docker.modem.socketPath ? '127.0.0.1' : options.docker.modem.host;
	this.config = options.config;
	this.auth = options.auth;
	this.container = null;
	this.id = null;
	this.images = {};
	this.statsStream = null;
	this._stats = null;
	this.exitReason = null;
	this.commands = options.commands;
	this.execs = {};

	var state = 0;
	this.__defineGetter__("state", function() {
		return self.states[state];
	});
	this.__defineSetter__("state", function(val) {
		//self.stdSystem.log('State changed from: ' + self.states[state] + ' to: ' + self.states[val]);
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

};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Container, events.EventEmitter);

Container.prototype.states = ['INITIALIZING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'CRASHED', 'DELETED'];

Container.prototype.start = function(callback) {
	debug('Container.start Starting image: ' + this.config.Image);
	var self = this;

	this.state = 1;
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

				self.runCommands(self.commands.pre, function(err) {

					if (err) {
						return self.stop(true, function() {
							callback(err)
						});
					}

					self.runMain(function(err) {

						if (err) {
							return self.stop(true, function() {
								callback(err)
							});
						}

						self.state = 2;
						self._info(function(err) {
							if (err)
								return callback(err);
							callback(null, container);
						});
					});
				});
			}, 1500);
		});
	});
};
Container.prototype.runMain = function(cb) {

	var self = this;
	var main = this.commands.main;
	main.container = this.container;
	main.logs = this.options.logs;
	debug('Container.runMain starting main tun: ' + main.cmd);
	var exec = new Exec(main);

	function onExit() {

	}


	exec.once('error', function(error) {
		self.emit('error', error)
		self.exitReason = 'CRASHED';
		self.runCommands(self.commands.clean, function() {
			self._clean(function() {
				self.state = 5;
			});
		});
	});
	exec.once('exit', function(data) {
		if (main.short) {
			self.state = 3;
			return self.runCommands(self.commands.clean, function() {
				self.state = 4;
				self.stop(true, function() {

				});
			});
		}
		if (self.state == 'STOPPING') {
			self.state = 4;
			self.runCommands(self.commands.clean, function() {
				self.stop(true, function() {
					self.state = 5;
				});
			});
		} else {
			self.exitReason = 'CRASHED';
			self.runCommands(self.commands.clean, function() {
				self.stop(true, function() {
					self.state = 5;
				});
			});
		}

		self.emit('wait', data);
	});
	exec.create(function() {
		self._info(function() {

			self._detectPort(function(err) {

				if (err) {
					return cb(err)
				}

				self.runCommands(self.commands.after, cb);
			});
		});
	});
};
Container.prototype.runIntervals = function(cb) {
	var self = this;

};
Container.prototype.runCommands = function(commandSet, cb) {
	var self = this;

	if (!commandSet || (commandSet.commands && commandSet.commands.length == 0)) {
		return cb();
	}
	var hasFailed = false;

	var tasks = [];

	async.parallel(commandSet.map(function(command) {
		return function(next) {

			var task = [];

			function run() {
				debug('Container.runCommands.run starting: ');
				command.commands.forEach(function(step, index) {
					task.push(function(next) {
							debug('Container.runCommands.step: ' + step.cmd);

						step.container = self.container;
						step.logs = self.options.logs;

						var exec = new Exec(step);
						exec.once('exit', function(data) {
							next(null, exec);
						});
						exec.create(function(err, data) {
							//console.log(err, data)
						});

					});

				});
				tasks.push(function(next) {
					async.series(task, function(err, execs) {
						if (command.pass) {
							for (var i = 0,
							    j = execs.length; i < j; i++) {
								if (!execs[i].pass) {
									hasFailed = true;
								}
							};
						}
						next();
					});
				});
				next()
			}

			if (command.wait) {

				debug('Container.runCommands having to wait: ' + command.wait.cmd);
				var waitPass = true;

				async.whilst(function(a) {
					return waitPass;
				}, function(whilstCb) {
					command.wait.container = self.container;
					command.wait.logs = self.options.logs;

					var exec = new Exec(command.wait);
					exec.once('exit', function(data) {

						if (exec.pass) {
							debug('Container.wait.cmd passed: ' + command.wait.cmd);
							waitPass = false;
							whilstCb(null, exec);
						} else {
							debug('Container.wait.cmd setTimeout(whilstCb, 1000): ' + command.wait.cmd);
							setTimeout(whilstCb, 1000);
						}
					});
					exec.create(function(err, data) {
						//console.log(err, data)
					});
				}, function(err) {
					if (err) {
						return cb(err)
					}
					run();

				});
			} else {
				run();
			}
		};
	}), function() {

		async.parallel(tasks, function() {
			if (hasFailed) {
				cb(new Error('One or more commands failed'));
			} else {
				cb();
			}
		});
	});

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
				self.emit('stop');
				callback();
			});
		} else {
			self.emit('stop');
			callback();
		}
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
	if (this.info.ports && this.info.ports.length == 0) {
		return callback();
	}
	if (this.options.process !== 'web') {
		//return callback();
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

Container.prototype._createContainer = function(callback) {
	debug('Container._createContainer Creating Container ' + this.config.Image);
	var self = this;
	this.docker.createContainer(this.config, function(error, container) {
		if (error) {
			console.log(error)
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

Container.prototype._clean = function(callback) {
	debug('Container._clean Cleaning old images ' + this.id);
	var self = this;

	//return callback();

	self.container.remove({
		v : true
	}, function(error, data) {
		if (error) {
			console.log(error)
			var err = new ContainerError('C7', error.reason);
			self.emit('error', err);
		}
		if (self.config.Image == self.baseImage) {
			return callback();
		}
		self.docker.getImage(self.config.Image).remove(callback);
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
			self._wait();
			return callback(err);
		}
		//console.log(error, data)
		callback()
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
		return console.log(self.state)
		if (self.state == 'STOPPED') {
			return self.emit('container_wait', data);
		}
		if (self.state == 'STOPPING') {
			self.state = 4;
		} else {
			self.exitReason = 'CRASHED';

			self._clean(function() {
				self.state = 5;
			});
		}

		self.emit('container_wait', data);

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

Container.prototype._detectPort = function(callback) {
	debug('Container._detectPort Building ports to detect');
	console.log(this.info.ports)
	if (this.info.ports.length == 0) {
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
			debug('Container._detectPortReady detected on port ' + port + ' host ' + host + ' for ' + this.id);
			called = true;
			callback();
		}
	};
	attempt(loop);
};

module.exports = Container;
