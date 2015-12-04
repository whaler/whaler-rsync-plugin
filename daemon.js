'use strict';

var Q = require('q');
var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');

var randomValueHex = function(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
};

var addCmd = function(whaler) {
    var console = whaler.require('./lib/console');

    whaler.cli.command(
        'rsync-daemon <ref> [volume]'
    ).argumentsHelp({
        'ref': 'Application or container name',
        'volume': 'Volume'
    }).description(
        'Rsync daemon'
    ).action(function(ref, volume, options) {

            var opts = {
                ref: ref,
                volume: volume
            };

            process.env.WHALER_DOCKER_PROGRESS = 'quiet';

            whaler.events.emit('rsync-daemon', opts, function(err, data) {
                if (err) {
                    return console.log(JSON.stringify({
                        type: 'error',
                        msg: err.message
                    }));
                }
                console.log(JSON.stringify(data));
            });

        });
};

module.exports = function(whaler) {

    addCmd(whaler);

    var rsyncContainer = Q.denodeify(function(opts, callback) {
        require('./container')(whaler, opts, callback);
    });

    var containerStart = Q.denodeify(function(container, opts, callback) {
        container.start(opts, callback);
    });
    var containerInspect = Q.denodeify(function(container, callback) {
        container.inspect(callback);
    });

    var rsyncExclude = function(file) {
        var exclude = [];
        if (fs.existsSync(file)) {
            exclude = fs.readFileSync(file, 'utf8').split('\n').filter(function(rule) {
                return rule.length > 0;
            }).map(function(rule) {
                return util.format('--exclude="%s"', rule);
            });
        }

        return exclude;
    };

    whaler.events.on('rsync-daemon', function(options, callback) {
        var appName = options['ref'];
        var containerName = null;

        var parts = options['ref'].split('.');
        if (2 == parts.length) {
            appName = parts[1];
            containerName = parts[0];
        }

        whaler.apps.get(appName, function(err, app) {
            var promise = Q.async(function*() {
                if (err) {
                    throw err;
                }

                var src = app.path;

                if (containerName) {
                    var volume = options['volume'];
                    if (!volume) {
                        throw new Error('In case of container name is provided, volume is mandatory!');
                    }

                    var container = whaler.docker.getContainer(containerName + '.' + appName);
                    var info = yield containerInspect(container);
                    var volumes = null;
                    if (info['Config']['Volumes']) {
                        volumes = Object.keys(info['Config']['Volumes']);
                    }

                    if (null === volumes || -1 === volumes.indexOf(volume)) {
                        throw new Error('Volume "' + volume + '" no found!');
                    }

                    var mounts = info['Mounts'];
                    while (mounts.length) {
                        var mount = mounts.shift();
                        if (volume == mount['Destination']) {
                            src = mount['Source'];
                        }
                    }
                }

                var credentials = {
                    username: randomValueHex(12),
                    password: randomValueHex(12)
                };

                var container = yield rsyncContainer({
                    src: src,
                    ref: 'rsync-daemon-' + options['ref'],
                    env: [
                        'USERNAME=' + credentials['username'],
                        'PASSWORD=' + credentials['password']
                    ]
                });

                try {
                    yield containerStart(container, {});
                } catch (e) {
                    container.remove({
                        force: true,
                        v: true
                    }, function() {});
                    throw e;
                }

                var info = yield containerInspect(container);

                var port = null;
                if (info['NetworkSettings']['Ports']['873/tcp']) {
                    port = info['NetworkSettings']['Ports']['873/tcp'][0]['HostPort'];
                }

                return {
                    port: port,
                    username: credentials['username'],
                    password: credentials['password'],
                    container: info['Name'].substring(1),
                    exclude: rsyncExclude(src + '/.rsyncignore')
                };

            })();

            promise.done(function(data) {
                callback(null, data);
            }, function(err) {
                callback(err);
            });

        });
    });
};
