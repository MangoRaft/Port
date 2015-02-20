var Docker = require('dockerode');
var util = require('util');
var fs = require('fs');
var net = require('net');
var path = require('path');
var events = require('events');
var os = require('os');
var portfinder = require('portfinder');
var async = require('async');
var Logger = require('raft-logger-redis').Logger;

var Container = require('./container');

const DEFAULT_MAX_CLIENTS = 1024;

var Port = function(options) {
	events.EventEmitter.call(this);

	this.options = options;

	this.name = options.name;
	this.environment = options.environment || 'development';
	this.shuttingDown = false;

	this.maxMemory = options.maxMemory;

	this.multiTenant = options.multiTenant;
	this.maxClients = this.multiTenant ? DEFAULT_MAX_CLIENTS : 1;

	this.reservedMemory = 0;
	this.usagedMemory = 0;

	this.cores = os.cpus().length;

	this.coresUsed = [];

	for (var i = 0; i < this.cores; i++) {
		this.coresUsed[i] = 0;
	};

	this.containers = {};
	this.docker = null;

};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Port, events.EventEmitter);

Port.prototype.run = function() {

	var options = {};

	if (this.options.docker.socket) {
		var socket = this.options.docker.socket || '/var/run/docker.sock';
		var stats = fs.statSync(socket);

		if (!stats.isSocket()) {
			throw new Error("Are you sure the docker is running?");
		}
		options.socketPath = socket;
	} else if (this.options.docker.host && this.options.docker.port) {
		options.host = this.options.docker.host;
		options.port = this.options.docker.port;
	}

	this.docker = new Docker(options);

	this._getEvents();

	this.emit('run');
};

Port.prototype.start = function(options, cb) {
	var self = this;
	var _options = {
		logs : options.logs,
		logSession : options.logSession,
		name : options.name,
		index : options.index,
		uid : options.uid,
		source : options.source,
		channel : options.name + '.' + options.index,
		process : options.process,
		docker : this.docker,
		config : {
			"Hostname" : options.name + '.' + options.index,
			"Memory" : options.limits.memory * 1048576 || 256 * 1048576,
			"MemorySwap" : options.limits.memory * 1048576 || 256 * 1048576,
			"CpuShares" : options.limits.cpuShares || 512,
			"Cpuset" : this.addResources(options.limits.memory, options.limits.cpuset || "0", options.limits.cpuShares || 512),
			"Tty" : false,
			"Image" : options.image,
			"Volumes" : {

			},
			"ExposedPorts" : {

			},
			"HostConfig" : {
				"PortBindings" : {

				},
			},
			"Dns" : ["8.8.8.8"]
		}
	};

	if (options.cmd) {
		_options.config.Cmd = options.cmd;
	}
	if (options.env) {
		_options.config.Env = [];
		Object.keys(options.env).forEach(function(key) {
			_options.config.Env.push(key + '=' + options.env[key]);
		});
	}
	if (options.volumes) {
		_options.config.Volumes = options.volumes;
	}

	async.parallelLimit(options.exposedPorts.map(function(exposedPort) {
		return function(next) {
			_options.config.ExposedPorts[exposedPort] = {};
			portfinder.getPort(function(err, port) {
				_options.config.HostConfig.PortBindings[exposedPort] = [{
					"HostPort" : "" + port
				}];
				next();
			});
		};
	}), 5, function(err) {
		self._start(_options, cb);
	});

};

Port.prototype.addResources = function(memory, cpuset, cpuShares) {
	var self = this;
	this.usagedMemory += memory;
	var _cpuset = [];
	var cores = typeof cpuset == 'number' ? cpuset : cpuset.split(',').length;
	for (var i = 0; i < cores; i++) {

		(function() { first:
			for (var j = 0; j < self.coresUsed.length; j++) {
				if (self.coresUsed[j] + cpuShares <= 1024) {

					for (var k = 0; k < _cpuset.length; k++) {
						if (_cpuset[k] == j) {
							continue first
						}

					};

					self.coresUsed[j] += cpuShares;
					_cpuset.push(j);
					return;
				}
			};
		})();
	};
	return _cpuset.join();
};

Port.prototype.removeResources = function(memory, cpuset, cpuShares) {
	this.usagedMemory -= memory;
	var cores = cpuset.split(',');
	for (var i = 0; i < cores.length; i++) {
		this.coresUsed[cores[i]] -= cpuShares;
	};
};

Port.prototype.destroy = function() {
	var self = this;

	async.parallelLimit(Object.keys(this.containers).map(function(uid) {
		console.log(uid);
		return function(cb) {
			self.stop(uid, cb);
		};
	}), 5, function(err) {

		process.nextTick(function() {
			self.emit('destroyed');
		});

	});
};

Port.prototype.stop = function(uid, cb) {
	var self = this;
	var container = this.containers[uid];
	if (container.state > 2) {
		return cb();
	}
	this.removeResources(container.config.Memory / 1048576, container.config.Cpuset, container.config.CpuShares);
	container.once('stop', cb);
	container.stop(false);
};

Port.prototype._start = function(options, cb) {
	var self = this;

	var container = new Container(options);

	function onError(err) {
		self.emit('error', err);
		if (container.started)
			return;
		container.once('STOPPED', function() {
			cb(err);
		});
		container.stop(false);
	}


	container.on('error', onError);

	container.once('start', function() {
		self.containers[container.id] = container;
		cb(null, container);
	});

	container.once('STOPPED', function(data) {
		delete self.containers[container.id];
		self.emit('STOPPED', self._options(container.options));
	});
	container.once('CRASHED', function(data) {
		delete self.containers[container.id];
		self.emit('CRASHED', self._options(container.options));
	});

	container.states.forEach(function(state) {
		container.on(state, function(data) {
			console.log('State changed to: ' + state);
		});
	});
	process.nextTick(function() {
		container.start();
	});

	return container;
};

Port.prototype._options = function(options) {
	var _options = {};

	Object.keys(options).forEach(function(key) {
		_options[key] = options[key];
	});
	delete _options.docker;
	return _options;
};

Port.prototype._getEvents = function() {
	var self = this;
	this.docker.getEvents({
		//
	}, function(err, stream) {
		if (err)
			return self.emit('error', err)
		stream.on('data', function(data) {
			var json = JSON.parse(data.toString());
			self.emit('docker ' + json.status, json);
		});
	});
};

module.exports = Port;
