Welcome to Port!	{#welcome}
=====================

Port is a docker managment module writen in node.

----------
> **NOTE:**
> 
> - Port is still in alpha state


Install
---------
To install Port you can use `npm`
#### <i class="icon-file"></i> NPM
```
$ npm install  port-docker
```

Usage
---------
You can require the module in your program.
```javascript
var Port = require('port-docker');
```
Initialize
---------
```javascript
var port = new Port({
	name : 'demo',
	environment : 'dev',
	maxMemory : 2222222,
	multiTenant : true,
	docker : {
		socket : '/var/run/docker.sock'
		//host : '192.168.1.111',
		//port : 5001,
	}
});
```
#Methods for Port
##port.run()
---------
Starts the module listing to docker
```js
port.run()
```

##port.start(options,callback)
---------
#### Options
- **logs.web.host** Required. Host for the logs web server.
- **logs.web.port** Required. Port for the logs web server.
- **logs.udp.host** Required. Host for the logs udp server.
- **logs.udp.port** Required. Port for the logs udp server.
- **logSession** Required. Logs session to send log server to.
- **source** Required. Source is used for logging.
- **name** Required. Name of the new container.
- **index** Required. Index of the container used for scalling.
- **uid** Required. UUID for this container.
- **limits.memory** Optional. Container memory limits. Value in MB.
- **limits.cpuShares** Optional. Relative weight of CPU usage to other container.
- **limits.cpuset** Optional. What cores to use with this container.
- **image** Required. Docker image to use.
- **cmd** Optional. Commands to run the container with.
- **exposedPorts** Optional. Array of ports to expose. `['6379/tcp', '6379/udp']`.

Starts a new container
```javascript
var stress = {
	logs : {
		"web" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		},
		"udp" : {
			"port" : 5000,
			"host" : "127.0.0.1"
		}
	},
	logSession : 'log.session',
	source : 'app',
	name : 'stress',
	index : 1,
	uid : 'uuid',
	username : 'username',
	limits : {
		memory : 75,
		cpuShares : 128,
		cpuset : "0,1,2,3"
	},
	image : 'progrium/stress',
	cmd : ['--cpu', '2', '--vm', '1', '--vm-bytes', '40M', '-q'],
	exposedPorts : []
};

port.start(redis, function(err, container) {
    //
});
```

##port.stop(id,callback)
---------
Stop a container with the containers id.
```javascript
port.stop(container.id, function(){
    //
})
```

Events
---------
####'run'
Once the module is running
```javascript
port.once('run', function() {
	console.log('run');
});
```
####'container error'
```javascript
port.on('container error', function(error) {
	console.log('error', error);
});
```