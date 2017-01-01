var Port = require('../lib/port');
var os = require('os');

var p = new Port({
	name : 'demo',
	environment : 'demo',
	maxMemory : os.totalmem() / Math.pow(1024, 2),
	multiTenant : true,
	baseImage : 'mongo',
	docker : {
		socket : '/var/run/docker.sock'
	}
});

p.on('error', function(err) {
	console.log(err);
	//throw err;
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

var volumes = {};
volumes[__dirname + '/mongo/data'] = '/data';

var mongo = {
	"logs" : logs,
	"name" : "docker.test",
	"index" : 1,
	"uid" : "uid",
	"volumes" : volumes,
	"env" : {
		"hello" : "world"
	},
	"size" : size,
	"image" : "mongo",
	"ports" : ['27017/tcp'],
	commands : {
		main : {
			cmd : 'mongod --auth --port 27017',
			code : 0,
			log : {
				stdout : 'stdout',
				stderr : 'stderr',
				stdin : null
			}

		},
		after : [{
			name : 'add user',
			pass : true,
			wait : {
				cmd : 'mongo admin --eval "help"',
				code : 0
			},

			commands : [{
				cmd : ['mongo', 'admin', '--eval', '"' + "db.createUser({user: 'admin', pwd: 'password', roles:[{role:'root',db:'admin'}]});" + '"'],
				code : 0
			}, {
				cmd : ['mongo', 'test', '-u', 'admin', '-p', 'password', '--authenticationDatabase', 'admin', '--eval', '"' + "db.createUser({user: 'test', pwd: 'password', roles:[{role:'dbOwner',db:'test'}]});" + '"'],
				code : 0,
				requiredCode : 0
			}]
		}]
	}
};

p.start(mongo, function(err, container) {
	if (err)
		console.log(err)
	//console.log(err, container)
});
