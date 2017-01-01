var Port = require('../lib/port');
var os = require('os');

var p = new Port({
	name : 'demo',
	environment : 'demo',
	maxMemory : os.totalmem() / Math.pow(1024, 2),
	multiTenant : true,
	baseImage : '127.0.0.1/cedar:runner',
	docker : {
		socket : '/var/run/docker.sock'
	}
});

p.run();

var logs = {
	"web" : {
		"port" : 5000,
		"host" : "127.0.0.1"
	},
	"udp" : {
		"port" : 5001,
		"host" : "127.0.0.1"
	},
	"view" : {
		"port" : 5000,
		"host" : "127.0.0.1"
	}
};
var size = {
	"type" : "2S",
	"memory" : 512,
	"memoryReservation" : 200,
	"cpuShares" : 64,
	"cpuset" : '1',
	"ioMaximumBandwidth" : 64,
	"ioMaximumIOps" : 2,
	"oomKillDisable" : true,
	"dedicated" : false
};

var builder = {
	"logs" : logs,
	"name" : "docker.test",
	"index" : 1,
	"uid" : "uid",
	"volumes" : {},
	"env" : {
		"hello" : "world"
	},
	"size" : size,
	"image" : "127.0.0.1/cedar:builder",
	"ports" : [],
	commands : {
		pre : [{
			name : 'pull app',
			pass : true,
			commands : [{
				cmd : 'wget http://127.0.0.1/test/mangoraft.43.tar -O /tmp/app.tar',
				code : 0
			}, {
				cmd : 'tar -xf /tmp/app.tar -C /tmp/app',
				requiredCode : 0,
				code : 0
			}]
		}, {
			name : 'pull cache',
			commands : [{
				cmd : 'wget http://127.0.0.1/test/cache.tar -O /tmp/cache.tar',
				code : 0
			}, {
				cmd : 'tar -xzf /tmp/cache.tar -C /tmp',
				code : 0,
				requiredCode : 0
			}, {
				cmd : 'mv /tmp/tmp/cache /tmp',
				code : 0,
				requiredCode : 0
			}]
		}],
		intervals : [{
			name : 'uptime',
			requires : 'main',
			interval : 60 * 1000,
			commands : [{
				cmd : 'uptime',
				code : 0,
				ttl : 60 * 1000,
				log : {
					stdout : 'stdout',
					stderr : 'stderr',
					stdin : null
				}
			}]
		}],
		main : {
			cmd : 'herokuish buildpack build',
			code : 0,
			ttl : Infinity,
			short : true,
			log : {
				stdout : {
					source : 'app',
					channel : 'redis.0',
					session : 'docker.test',
					bufferSize : 5
				},
				stderr : {
					source : 'app',
					channel : 'redis.0',
					session : 'docker.test',
					bufferSize : 5
				},
				stdin : null
			},
			log : {
				stdout : 'stdout',
				stderr : 'stderr',
				stdin : null
			}

		},
		clean : [{
			name : 'upload app',
			commands : [{
				cmd : 'tar -czf /tmp/build.tar /app',
				code : 0
			}, {
				cmd : ['mc', 'cp', '--quiet', '/tmp/build.tar', 's3/test/build' + Date.now() + '.tar'],
				code : 0,
				requiredCode : 0
			}]
		}, {
			name : 'upload cache',
			commands : [{
				cmd : 'tar -czf /tmp/cache.tar /tmp/cache',
				code : 0,
				ttl : 60 * 1000
			}, {
				cmd : ['mc', 'cp', '--quiet', '/tmp/cache.tar', 's3/test/cache.tar'],
				code : 0,
				requiredCode : 0
			}]
		}]
	}

};
p.start(builder, function(err, container) {
	if (err)
		throw err
	//console.log(err, container)
});
p.on('error', function(err) {
	console.log(err);
	//throw err;
});

process.on('SIGINT', function() {

	p.destroy(function(data) {
		console.log('destroyed', data);
		process.exit(1);
	});
});
