var util = require('util');
var fs = require('fs');
var net = require('net');
var path = require('path');
var events = require('events');
var os = require('os');
var net = require('net');
var Socket = net.Socket;

var async = require('async');
var Metrics = require('metrics-server').metric;
var Logger = require('../../Logger').Logger;

var Container = function(options) {
	events.EventEmitter.call(this);
	var self = this;
	this.options = options;

	this.docker = options.docker;
	this.config = options.config;
	this.container = null;
	this.id = null;
	this.images = {};
	this.exitReason = null;

	var state = 0;
	this.__defineGetter__("state", function() {
		return state;
	});
	this.__defineSetter__("state", function(val) {
		self.stdSystem.log('State changed from: ' + self.states[state] + ' to: ' + self.states[val]);
		state = val;
		self.emit(self.states[state]);
	});
	this.statsInterval = options.statsInterval || 1000;
	this.statsTimmer = 0;
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

Container.prototype.start = function() {
	var self = this;
	if (!this.container) {
		this.state = 1;
		this.once('_pull', function(container) {
			self.once('container', function(container) {
				self.id = container.id;
				self.once('_start', function() {
					self._detectPort(function(err) {
						if (err) {
							self.emit('error', err)
							self.stop(true)
						} else {
							self.emit('start')
						}
						self.state = 2;

					});
				});
				self._start();
			});
			self._createContainer();
		});
		self._pull();
	}
};
Container.prototype.stop = function(clean) {
	var self = this;
	if (this.state > 2) {
		return;
	}
	this.state = 3;
	this.once('_stop', function(container) {
		if (clean) {
			self.once('_clean', function() {
				self.state = 6;
			});
			self._clean();
		}
		self.std.stop(function() {
			self.stdSystem.stop(function() {
				self.emit('stop');
			});
		});
	});
	this._stop();
};
Container.prototype.inspect = function(cb) {
	var self = this;
	this.once('_inspect', function(inspect) {
		self.emit('inspect', inspect);
		if (cb) {
			cb(null, inspect);
		}
	});
	this._inspect();
};
Container.prototype.top = function(cb) {
	var self = this;
	this.once('_top', function(data) {
		var top = [];
		data.Processes.forEach(function(processe) {
			var a = {};
			processe.forEach(function(item, index) {
				a[data.Titles[index]] = item;
			});
			top.push(a);
		});
		self.emit('top', top);
		if (cb) {
			cb(null, top);
		}
	});
	this._top();
};
Container.prototype.pause = function() {
	//
};
Container.prototype.resume = function() {
	//
};
Container.prototype.info = function(cb) {
	var self = this;

	this.inspect(function(err, inspect) {
		if (err) {
			self.emit('error', err);
			return cb(err);
		}
		var info = {
			ports : [],
			env : {},
			image : self.options.config.Image,
			logs : self.options.logs,
			logSession : self.options.logSession,
			name : self.options.name,
			index : self.options.index,
			uid : self.options.uid,
			id : self.id
		};

		var ip = self._ipAddress();

		Object.keys(inspect.NetworkSettings.Ports).forEach(function(key) {
			inspect.NetworkSettings.Ports[key].forEach(function(item) {
				info.ports.push({
					forward : key,
					port : item.HostPort,
					ip : ip
				});
			});
		});

		inspect.Config.Env.forEach(function(env) {
			env = env.split('=');
			info.env[env.shift()] = env.join('=');
		});

		cb(null, info);

	});
};
/**
 *
 */

Container.prototype._detectPort = function(cb) {
	var ports = [];
	var self = this;
	this.inspect(function(err, inspect) {
		if (err) {
			return self.emit('error', err);
		}

		var ip = self._ipAddress();

		Object.keys(inspect.NetworkSettings.Ports).forEach(function(key) {
			inspect.NetworkSettings.Ports[key].forEach(function(item) {
				ports.push({
					forward : key,
					port : item.HostPort,
					ip : ip
				});
			});
		});

	});

	async.parallel(ports.map(function(item) {
		return function(next) {
			self._detectPortReady(item.port, next);
		};
	}), function(errs) {
		if (errs && errs.length > 0) {
			cb(errs[0])
		} else {
			cb(null)
		}
	});
};
Container.prototype._ipAddress = function() {
	var interfaces = os.networkInterfaces();
	var addresses = Object.keys(interfaces).map(function(nic) {
		var addrs = interfaces[nic].filter(function(details) {
			return details.address !== '127.0.0.1' && details.family === 'IPv4';
		});
		return addrs.length ? addrs[0].address : undefined;
	}).filter(Boolean);
	return addresses.length ? addresses[0] : '127.0.0.1';
};
Container.prototype._createContainer = function() {
	var self = this;
	this.docker.createContainer(this.config, function(err, container) {
		if (err) {
			return self.emit('error', err);
		}
		self.container = container;
		self.emit('container', container);
	});
};
Container.prototype._attach = function() {
	var self = this;
	this.container.attach({
		stream : true,
		stdout : true,
		stderr : true
	}, function(err, stream) {
		if (err) {
			return self.emit('error', err);
		}

		self.container.modem.demuxStream(stream, self.std, self.std);

		self.emit('attach', self.std);
	});
};
Container.prototype._clean = function() {
	var self = this;
	this.container.remove(function(err, data) {
		if (err) {
			self.emit('error', err);
		}

		async.parallelLimit(Object.keys(self.images).map(function(image) {
			return function(cb) {
				self.docker.getImage(image).remove(cb);
			};
		}), 5, function(err) {
			self.emit('_clean');
		});
	});
};
Container.prototype._top = function() {
	var self = this;
	this.container.top({
		ps_args : 'aux'
	}, function(err, data) {
		if (err) {
			return self.emit('error', err);
		}
		self.emit('_top', data);
	});
};
Container.prototype._inspect = function() {
	var self = this;
	this.container.inspect(function(err, data) {
		if (err) {
			return self.emit('error', err);
		}
		self.emit('_inspect', data);
	});
};
Container.prototype._start = function() {
	var self = this;
	this.container.start(function(err, data) {
		if (err) {
			return self.emit('error', err);
		}
		self.emit('_start', data);
		self._wait();
		self._attach();
	});
};
Container.prototype._wait = function() {
	var self = this;
	this.container.wait(function(err, data) {
		if (err) {
			return self.emit('error', err);
		}

		if (self.state == 3) {
			self.state = 4;
		} else {
			self.exitReason = 'CRASHED';
			clearInterval(self.statsTimmer);
			self.once('_clean', function() {
				self.state = 6;
			});
			self._clean();
			self.state = 5;
		}

		self.stdSystem.log('Exit code: ' + data.StatusCode);
		;
	});
};
Container.prototype._pull = function() {
	var self = this;
	this.docker.pull(this.config.Image, function(err, stream) {
		if (err) {
			console.log(err)
			return self.emit('error', err);
		}
		stream.on('data', function(data) {
			var json = JSON.parse(data.toString());
			self.images[json.id] = true;
		});
		stream.on('end', function(data) {
			self.emit('_pull');
		});
	});
};
Container.prototype._stop = function() {
	var self = this;

	clearInterval(this.statsTimmer);
	this.container.stop(function(err, data) {
		if (err) {
			return self.emit('error', err);
		}
		self.emit('_stop', data);
	});
};

Container.prototype._detectPortReady = function(port, callback) {
	var self = this;

	var attempts = 0;
	function attempt(cb) {
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
		socket.connect(port);
	}

	var loop = function(err) {
		attempts += 1;
		if (err) {
			if (attempts > 120 || self.state != 'STARTING') {
				callback(new Error('App not listing on required port'));
			} else {
				setTimeout(function() {
					attempt(loop);
				}, 500);
			}
		} else {
			callback();
		}
	};
	attempt(loop);
};

module.exports = Container;
