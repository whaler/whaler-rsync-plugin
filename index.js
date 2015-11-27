'use strict';

var Q = require('q');
var fs = require('fs');
var tls = require('tls');
var path = require('path');

var addCmd = function(whaler) {
    var console = whaler.require('./lib/console');

    whaler.cli.command(
        'rsync <source> <destination>'
    ).alias(
        'sync'
    ).description(
        'Syncronize application volumes'
    ).action(function(source, destination, options) {

            var opts = {
                src: source,
                dst: destination
            };

            process.env.WHALER_DOCKER_PROGRESS = 'quiet';

            whaler.events.emit('rsync', opts, function(err) {
                console.log('');
                if (err) {
                    return console.error('[%s] %s', process.pid, err.message, '\n');
                }
            });

        }).on('--help', function() {
            whaler.cli.argumentsHelp(this, {
                'source': 'Source',
                'destination': 'Destination'
            });
        });
};

module.exports = function(whaler) {

    var console = whaler.require('./lib/console');

    addCmd(whaler);

    require('./daemon')(whaler);
    require('./kill')(whaler);

    var rsyncContainer = Q.denodeify(function(opts, callback) {
        require('./container')(whaler, opts, callback);
    });

    var emitRsync = Q.denodeify(function(options, callback) {
        whaler.events.emit('rsync', options, callback);
    });

    var containerStart = Q.denodeify(function(container, opts, callback) {
        container.start(opts, callback);
    });

    var containerInspect = Q.denodeify(function(container, callback) {
        container.inspect(callback);
    });

    var containerLogs = Q.denodeify(function(container, callback) {
        container.logs({
            follow: true,
            stdout: true,
            stderr: true
        }, function(err, stream) {
            if (err) {
                callback(err);
            }
            stream.setEncoding('utf8');
            stream.on('data', function(data) {
                process.stdout.write(data);
            });
            stream.on('end', function(data) {
                callback(null);
            });
        });
    });

    var getType = function(value) {
        return 'string' === typeof value ? 'local' : 'remote';
    };

    var parseArgs = function(value) {
        if (value.indexOf('@') > -1) {
            var values = value.split('@');

            var containerName = null;
            var appName = values[0];

            var parts = appName.split('.');
            if (2 == parts.length) {
                appName = parts[1];
                containerName = parts[0];
            }

            var host = values[1];
            var volume = null;
            if (containerName) {
                var parts = host.split(':');
                volume = parts.pop();
                host = parts.join(':');

                if (!/^\//.test(volume)) {
                    throw new Error('In case of container name is provided, volume is mandatory!');
                }
            }

            return {
                ref: values[0],
                host: host,
                volume: volume,
                appName: appName,
                containerName: containerName
            };
        }

        if (!path.isAbsolute(value)) {
            value = path.join(process.cwd(), path.normalize(value));
        }

        return value;
    };

    var createClient = function(host) {
        var port = 1337;

        var parts = host.split(':');
        if (parts.length > 1) {
            host = parts[0];
            port = parts[1];
        }

        var lh = ['127.0.0.1', 'localhost', 'whaler'];

        // local
        if (-1 !== lh.indexOf(host)) {
            return;
        }

        // remote
        try {
            var key = fs.readFileSync(process.env.HOME + '/.whaler/ssl/' + host + '.key');
            var cert = fs.readFileSync(process.env.HOME + '/.whaler/ssl/' + host + '.crt');
        } catch (e) {}

        var options = {
            key: key,
            cert: cert,
            rejectUnauthorized: false
        };

        var client = tls.connect(port, host, options);
        client.__host = host;

        return client;
    };

    var killDaemon = Q.denodeify(function(config, callback) {
        if (config.remote) {
            var client = createClient(config.remote);

            client.on('error', function(err) {
                callback(err);
            });

            client.on('connect', function() {
                client.on('data', function(data) {
                    process.stdout.write(data);
                });
                client.write(JSON.stringify({
                    name: 'whaler_rsync',
                    argv: [
                        'rsync-kill',
                        config.container
                    ]
                }));
            });

            client.on('end', function() {
                callback(null);
            });

            return;
        }

        whaler.events.emit('rsync-kill', {
            container: config.container
        }, callback);
    });

    var runDaemon = Q.denodeify(function(config, callback) {
        var client = createClient(config.host);

        if (!client) {
            whaler.events.emit('rsync-daemon', {
                ref: config.ref,
                volume: config.volume
            }, function(err, response) {
                if (err) {
                    return callback(err);
                }
                response['host'] = process.env.WHALER_DOCKER_IP || '172.17.0.1';
                callback(null, response);
            });

            return;
        }

        client.on('error', function(err) {
            callback(err);
        });

        var response = null;
        client.on('connect', function() {
            client.on('data', function(data) {
                try {
                    var json = JSON.parse(data.toString());
                    response = json;
                } catch (e) {
                    process.stdout.write(data);
                }
            });
            client.write(JSON.stringify({
                name: 'whaler_rsync',
                argv: [
                    'rsync-daemon',
                    config.ref,
                    config.volume
                ]
            }));
        });

        client.on('end', function() {
            if (!response) {
                return callback(new Error('Error'));
            }

            if ('error' == response['type']) {
                return callback(new Error(response['msg']));
            }

            response['host'] = client.__host;
            response['remote'] = config.host;

            callback(null, response);
        });
    });

    var makeCmd = function() {
        var cmd = ['rsync'];

        cmd.push('-az');              // https://download.samba.org/pub/rsync/rsync.html
        cmd.push('--numeric-ids');    // don't map uid/gid values by user/group name
        cmd.push('--human-readable'); // output numbers in a human-readable format
        cmd.push('--verbose');        // increase verbosity

        return cmd;
    };

    var generateRsync = function(config) {
        return 'rsync://'+ config.username + '@' + config.host + ':' + config.port + '/data';
    };

    whaler.events.on('rsync', function(options, callback) {
        var src = parseArgs(options['src']);
        var dst = parseArgs(options['dst']);

        var remote = {};
        var container = null;
        var cleaning = function(done) {
            if (container) {
                container.remove({
                    force: true,
                    v: true
                }, function() {});
            }

            var promise = Q.async(function*() {
                var keys = Object.keys(remote);
                while (keys.length) {
                    var data = remote[keys.shift()];
                    yield killDaemon(data);
                }
            })();

            promise.done(function() {
                done();
            }, function(err) {
                done(err);
            });
        };

        var promise = Q.async(function*() {

            if ('local' === getType(src) && 'local' === getType(dst)) {
                throw new Error('not supported');
            }

            if ('remote' === getType(src) && 'remote' === getType(dst)) {
                container = yield rsyncContainer({
                    ref: 'rsync-' + Math.floor(new Date().getTime() / 1000)
                });
                var info = yield containerInspect(container);

                var mounts = info['Mounts'];
                while (mounts.length) {
                    var mount = mounts.shift();
                    if ('/volume' == mount['Destination']) {

                        yield emitRsync({
                            src: options['src'],
                            dst: mount['Source']
                        });

                        yield emitRsync({
                            src: mount['Source'],
                            dst: options['dst']
                        });
                    }
                }

                return;
            }

            if ('local' === getType(src) && 'remote' === getType(dst)) {
                var dstConf = remote['dst'] = yield runDaemon(dst);

                var cmd = makeCmd();
                if (fs.existsSync(src + '/.rsyncignore')) {
                    cmd.push('--exclude-from=/volume/.rsyncignore'); // rsync ignore
                }
                cmd.push('/volume/');
                cmd.push(generateRsync(dstConf));

                container = yield rsyncContainer({
                    src: src,
                    cmd: cmd,
                    env: [
                        'RSYNC_PASSWORD=' + dstConf.password
                    ]
                });

            } else {
                var srcConf = remote['src'] = yield runDaemon(src);

                var cmd = makeCmd();
                if (srcConf.exclude) {
                    cmd = cmd.concat(srcConf.exclude); // rsync ignore
                }
                cmd.push(generateRsync(srcConf));
                cmd.push('/volume');

                container = yield rsyncContainer({
                    src: dst,
                    cmd: cmd,
                    env: [
                        'RSYNC_PASSWORD=' + srcConf.password
                    ]
                });
            }

            yield containerStart(container, {});
            yield containerLogs(container);

        })();

        promise.done(function() {
            cleaning(function() {
                callback(null);
            });
        }, function(err) {
            cleaning(function() {
                callback(err);
            });
        });
    });
};
