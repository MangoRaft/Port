var util = require('util');
var fs = require('fs');
var net = require('net');
var path = require('path');
var events = require('events');
var os = require('os');
var async = require('async');
var Metrics = require('metrics-server').metric;
var Logger = require('raft-logger-redis').Logger;

var Container = function(options) {
	events.EventEmitter.call(this);

	this.options = options;

	this.docker = options.docker;
	this.config = options.config;
	this.container = null;
	this.id = null;
	this.images = {};

	this.kill = false;
	this.statsInterval = options.statsInterval || 1000;
	this.statsTimmer = 0;
	this.stopping = false;
	this.deid = false;

	this.metrics = {
		memory : {
			cache : 0,
			rss : 0,
			swap : 0
		},
		cpu : {
			user : {
				count : 0,
				change : 0
			},
			system : {
				count : 0,
				change : 0
			}
		},
		io : {
			sectors : 0,
			serviceBytesRead : 0,
			serviceBytesWrite : 0,
			serviceBytesTotal : 0
		}
	};

	this.stdout = Logger.createLogger(this.options.logs).create({
		source : this.options.name,
		channel : 'stdout.' + this.options.index,
		session : this.options.logSession,
		bufferSize : 1
	});
	this.stderr = Logger.createLogger(this.options.logs).create({
		source : this.options.name,
		channel : 'stderr.' + this.options.index,
		session : this.options.logSession,
		bufferSize : 1
	});
};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Container, events.EventEmitter);

Container.prototype.start = function() {
	var self = this;
	if (!this.container) {

		this.once('_pull', function(container) {
			self.once('container', function(container) {
				self.id = container.id;

				self.once('_start', function() {
					self.emit('start');
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
	if (this.stopping || this.deid) {
		return;
	}
	this.once('_stop', function(container) {
		if (clean) {
			self.once('_clean', function() {
				self.emit('stop');
			});
			self._clean();
		} else {
			self.emit('stop');
		}
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
			throw err;
		}
		var info = {
			ports : [],
			env : {},
			image : self.options.config.Image,
			metrics : self.options.metrics,
			metricSesion : [],
			logs : self.options.logs,
			logSession : self.options.logSession,
			name : self.options.name,
			index : self.options.index,
			uid : self.options.uid,
		};

		function getMetricsKey(group) {
			return function(key) {
				info.metricSesion.push(self.options.metricSesion + '.' + group + '.' + key);
			};
		}
		Object.keys(self.metrics.memory).forEach(getMetricsKey('memory'));
		Object.keys(self.metrics.cpu).forEach(getMetricsKey('cpu'));
		Object.keys(self.metrics.io).forEach(getMetricsKey('io'));

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

Container.prototype._ipAddress = function() {
	var interfaces = os.networkInterfaces();

	var addresses = Object.keys(interfaces).map(function(nic) {
		var addrs = interfaces[nic].filter(function(details) {
			return details.address !== '127.0.0.1' && details.family === 'IPv4'
		});
		return addrs.length ? addrs[0].address : undefined;
	}).filter(Boolean);
	return addresses.length ? addresses[0] : '127.0.0.1';
};
Container.prototype._createContainer = function() {
	var self = this;
	this.docker.createContainer(this.config, function(err, container) {
		if (err) {
			throw err
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
			throw err
		}

		self.container.modem.demuxStream(stream, self.stdout, self.stderr);

		self.emit('attach', self.stdout, self.stderr);
	});
};
Container.prototype._clean = function() {
	var self = this;
	this.container.remove(function(err, data) {
		if (err) {
			//throw err
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
			throw err;
		}
		self.emit('_top', data);
	});
};
Container.prototype._inspect = function() {
	var self = this;
	this.container.inspect(function(err, data) {
		if (err) {
			throw err
		}
		self.emit('_inspect', data);
	});
};
Container.prototype._start = function() {
	var self = this;
	this.container.start(function(err, data) {
		if (err) {
			throw err
		}
		self.emit('_start', data);
		self._wait();
		self._attach();
		self._metrics();
	});
};
Container.prototype._wait = function() {
	var self = this;
	this.container.wait(function(err, data) {
		if (err) {
			throw err
		}

		if (this.stopping) {
			self.emit('exit', data);
		} else {
			self.deid = true;
			clearInterval(self.statsTimmer);
			self.once('_clean', function() {
				self.emit('death', data);
			});
			self._clean();
		}
	});
};
Container.prototype._pull = function() {
	var self = this;
	this.docker.pull(this.config.Image, function(err, stream) {
		if (err) {
			throw err
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
	if (this.stopping)
		return;
	this.stopping = true;
	clearInterval(this.statsTimmer);
	this.container.stop(function(err, data) {
		if (err) {
			throw err;
		}
		self.emit('_stop', data);
	});
};

Container.prototype._createMetris = function() {
	var self = this;
	function setMetrics(group) {
		return function(key) {
			var m = self.metrics[group][key] = Metrics.createMetric(self.options.metrics);
			m.interval = false;
			m.token = self.options.metricSesion + '.' + group + '.' + key;
			if (group == 'cpu' || group == 'io') {
				m.count = 0;
			}
			m.start();
		};
	}


	Object.keys(self.metrics.memory).forEach(setMetrics('memory'));
	Object.keys(self.metrics.cpu).forEach(setMetrics('cpu'));
	Object.keys(self.metrics.io).forEach(setMetrics('io'));
};
Container.prototype._metrics = function() {
	var self = this;
	this._createMetris();
	this.statsTimmer = setInterval(function() {
		self._memroyMetrics();
		self._cpuMetrics();
		self._blkioSectorsMetrics()
	}, this.statsInterval);
};
Container.prototype._memroyMetrics = function() {
	var self = this;
	fs.readFile('/sys/fs/cgroup/memory/system.slice/docker-' + this.id + '.scope/memory.stat', function(err, data) {
		if (err)
			throw err;

		data = data.toString().split('\n');
		data.pop();
		var stats = {};

		data.map(function(line) {
			stats[line.split(' ')[0]] = line.split(' ')[1];
		});
		Object.keys(self.metrics.memory).forEach(function(key) {
			self.metrics.memory[key].cb(stats[key]);
		});
		self.emit('metrics memory', self.metrics.memory);
	});
};
Container.prototype._cpuMetrics = function() {
	var self = this;
	fs.readFile('/sys/fs/cgroup/cpu/system.slice/docker-' + self.id + '.scope/cpuacct.stat', function(err, data) {
		if (err)
			throw err;

		data = data.toString().split('\n');
		data.pop();
		var stats = {};

		data.map(function(line) {
			stats[line.split(' ')[0]] = line.split(' ')[1];
		});

		Object.keys(self.metrics.cpu).forEach(function(key) {
			self.metrics.cpu[key].cb(stats[key] - self.metrics.cpu[key].count);
			self.metrics.cpu[key].count = stats[key];
		});
		self.emit('metrics cpu', self.metrics.cpu);
	});
};
Container.prototype._blkioSectorsMetrics = function() {
	var self = this;

	function read(file, cb) {
		fs.readFile('/sys/fs/cgroup/blkio/system.slice/docker-' + self.id + '.scope/' + file, function(err, data) {
			if (err)
				throw err;

			data = data.toString().split('\n');
			data.pop();
			cb(null, data);
		});
	}

	read('blkio.sectors', function(err, sectors) {
		
		sectors = sectors.join('').split(' ').pop();
		self.metrics.io['sectors'].cb(sectors - self.metrics.io['sectors'].count);
		self.metrics.io['sectors'].count = sectors;
		
		read('blkio.io_service_bytes', function(err, io_service_bytes) {

			var serviceBytesRead = io_service_bytes[0].split(' ').pop();
			var serviceBytesWrite = io_service_bytes[1].split(' ').pop();
			var serviceBytesTotal = io_service_bytes[4].split(' ').pop();

			self.metrics.io['serviceBytesRead'].cb(serviceBytesRead - self.metrics.io['serviceBytesRead'].count);
			self.metrics.io['serviceBytesRead'].count = serviceBytesRead;

			self.metrics.io['serviceBytesWrite'].cb(serviceBytesWrite - self.metrics.io['serviceBytesWrite'].count);
			self.metrics.io['serviceBytesWrite'].count = serviceBytesWrite;

			self.metrics.io['serviceBytesTotal'].cb(serviceBytesTotal - self.metrics.io['serviceBytesTotal'].count);
			self.metrics.io['serviceBytesTotal'].count = serviceBytesTotal;

		});
	});
};
Container.prototype.resume = function() {
	//
};

module.exports = Container;
