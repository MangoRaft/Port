var Port = require('../lib/port');
var DStats = require('../../DStats/lib/dstats');
var dstats = new DStats({
    host : '127.0.0.1',
    port : 8125,
    key : '2dcd78e1-cea9-4bab-8e5c-6ecbc2579479'
});
var p = new Port({
    name: 'demo',
    environment: 'demo',
    maxMemory: 2222222,
    multiTenant: true,
    docker: {
        socket: '/var/run/docker.sock'
    }
});

p.run();

var cpu = {
    "logs": {
        "web": {
            "port": 5000,
            "host": "127.0.0.1"
        },
        "udp": {
            "port": 5001,
            "host": "127.0.0.1"
        },
        "view": {
            "port": 5000,
            "host": "127.0.0.1"
        }
    },
    "logSession": "docker",
    "name": "docker.cpu",
    "index": 1,
    "uid": "cpu",
    "source": "app",
    "channel": "cpu.1",
    "process": "web",
    "volumes": {},
    "env": {
        "hello": "world"
    },
    "image": "progrium/stress",
    "ports": [],
    shortLived: true,
    cmd: '--cpu 4 --timeout 10',
    size: {
        memory: 128,
        swap: 128,
        memoryReservation: 128,
        cpu: 10,
        memory: 128,
        io: {
            bandwidth: 10,
            iops: 10
        }
    }
};
//docker run --rm --name fio --device-write-iops /dev/loop0:100 \ --device-read-iops /dev/loop0:100 fio --ioengine=libaio --rw=randrw --runtime=10 --size=32M --bs=32k --iodepth=16  --numjobs=4 --name=fio_rw_test --group_reporting
var memory = {
    "logs": {
        "web": {
            "port": 5000,
            "host": "127.0.0.1"
        },
        "udp": {
            "port": 5001,
            "host": "127.0.0.1"
        },
        "view": {
            "port": 5000,
            "host": "127.0.0.1"
        }
    },
    "logSession": "docker",
    "name": "docker.memory",
    "index": 1,
    "uid": "memory",
    "source": "app",
    "channel": "memory.1",
    "process": "web",
    "volumes": {},
    "env": {
        "hello": "world"
    },
    "image": "mangoraft/fio",
    "ports": [],
    exclude:['mangoraft/fio'],
    shortLived: true,
    stats: true,
    cmd: '--ioengine=libaio --rw=randrw --runtime=10 --size=32M --bs=32k --iodepth=16  --numjobs=4 --name=fio_rw_test --group_reporting',
    size: {
        memory: 128,
        swap: 128,
        memoryReservation: 128,
        cpu: 10,
        memory: 128,
        io: {
            bandwidth: 0.01,
            iops: 0.01
        }
    }
};

async function start() {
    let memContainer = await p.start(memory);
    memContainer.on('stats', function (stats) {
        dstats.stats(stats);
    });

    setTimeout(async function () {
        await memContainer.stop(true);
        start()
    }, 10000);

    console.log(`avalibaleCPU:${p.avalibaleCPU()}`)
}


p.on('error', function (err) {
   // console.log(err);
});

start()