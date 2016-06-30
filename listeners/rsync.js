'use strict';

var fs = require('fs');
var tls = require('tls');
var path = require('path');

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.on('rsync', function* (options) {
        const src = parseArgs(options['src']);
        const dst = parseArgs(options['dst']);

        const docker = whaler.get('docker');

        let err = null;
        let container = null;
        const remote = {};

        if ('local' === rsyncType(src) && 'local' === rsyncType(dst)) {
            throw new Error('not supported');
        }

        const rsyncContainer = require('../lib/container');

        try {
            if ('remote' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                container = yield rsyncContainer.$call(null, docker, {
                    ref: 'rsync-' + Math.floor(new Date().getTime() / 1000)
                });
                const info = yield container.inspect.$call(container);

                const mounts = info['Mounts'];
                for (let mount of mounts) {
                    if ('/volume' == mount['Destination']) {
                        yield whaler.$emit('rsync', {
                            src: options['src'],
                            dst: mount['Source']
                        });

                        yield whaler.$emit('rsync', {
                            src: mount['Source'],
                            dst: options['dst']
                        });
                    }
                }

            } else {

                if ('local' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                    const dstConf = remote['dst'] = yield runDaemon.$call(whaler, dst);

                    let cmd = makeCmd();
                    if (fs.existsSync(src + '/.rsyncignore')) {
                        cmd.push('--exclude-from=/volume/.rsyncignore'); // rsync ignore
                    }

                    const stat = yield fs.lstat.$call(null, src);
                    if (stat.isDirectory()) {
                        cmd.push('/volume/');
                    } else {
                        cmd.push('/volume/' + path.basename(src));
                    }

                    cmd.push(generateRsync(dstConf));

                    container = yield rsyncContainer.$call(null, docker, {
                        src: stat.isDirectory() ? src : path.dirname(src),
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + dstConf.password
                        ]
                    });

                } else {
                    const srcConf = remote['src'] = yield runDaemon.$call(whaler, src);

                    let cmd = makeCmd();
                    if (srcConf.exclude) {
                        cmd = cmd.concat(srcConf.exclude); // rsync ignore
                    }
                    
                    if (srcConf.file) {
                        cmd.push(generateRsync(srcConf) + '/' + srcConf.file);
                        cmd.push('/volume/');
                    } else {
                        cmd.push(generateRsync(srcConf));
                        cmd.push('/volume');
                    }

                    container = yield rsyncContainer.$call(null, docker, {
                        src: dst,
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + srcConf.password
                        ]
                    });
                }

                yield container.start.$call(container, {});
                const stream = yield container.logs.$call(container, {
                    follow: true,
                    stdout: true,
                    stderr: true
                });

                yield writeLogs.$call(null, stream);
            }

        } catch (e) {
            err = e;
        }

        if (container) {
            yield container.remove.$call(container, {
                force: true,
                v: true
            });
        }

        for (let key of Object.keys(remote)) {
            yield killDaemon.$call(whaler, remote[key]);
        }

        if (err) {
            throw err;
        }
    });
}

// PRIVATE

/**
 * @returns {string[]}
 */
function makeCmd() {
    const cmd = ['rsync'];

    cmd.push('-az');              // https://download.samba.org/pub/rsync/rsync.html
    cmd.push('--numeric-ids');    // don't map uid/gid values by user/group name
    cmd.push('--human-readable'); // output numbers in a human-readable format
    cmd.push('--verbose');        // increase verbosity

    return cmd;
}

/**
 * @param config
 * @returns {string}
 */
function generateRsync(config) {
    return 'rsync://'+ config.username + '@' + config.host + ':' + config.port + '/data';
}

/**
 * @param value
 * @returns {*}
 */
function parseArgs(value) {
    if (value.indexOf('@') > -1) {
        const values = value.split('@');

        let appName = values[0];
        let serviceName = null;

        const parts = appName.split('.');
        if (2 == parts.length) {
            appName = parts[1];
            serviceName = parts[0];
        }

        let host = values[1];
        let volume = null;
        if (serviceName) {
            const parts = host.split(':');
            volume = parts.pop();
            host = parts.join(':');

            if (!/^\//.test(volume)) {
                throw new Error('In case of container name is provided, volume is mandatory!');
            }
        } else {
            const parts = host.split(':');
            if (/^\//.test(parts[parts.length - 1])) {
                volume = parts.pop();
                host = parts.join(':');
            }
        }

        return {
            ref: values[0],
            host: host,
            volume: volume,
            appName: appName,
            serviceName: serviceName
        };
    }

    if (!path.isAbsolute(value)) {
        value = path.join(process.cwd(), path.normalize(value));
    }

    return value;
}

/**
 * @param value
 * @returns {string}
 */
function rsyncType(value) {
    return 'string' === typeof value ? 'local' : 'remote';
}

/**
 * @param stream
 * @param callback
 */
function writeLogs(stream, callback) {
    stream.setEncoding('utf8');
    stream.on('data', function(data) {
        process.stdout.write(data);
    });
    stream.on('end', function() {
        callback(null);
    });
}

/**
 * @param host
 */
function createClient(host) {
    let port = 1337;

    const parts = host.split(':');
    if (parts.length > 1) {
        host = parts[0];
        port = parts[1];
    }

    const lh = ['127.0.0.1', 'localhost', 'whaler'];

    // local
    if (-1 !== lh.indexOf(host)) {
        return;
    }

    // remote
    let key, cert;
    try {
        key = fs.readFileSync(process.env.HOME + '/.whaler/ssl/' + host + '.key');
        cert = fs.readFileSync(process.env.HOME + '/.whaler/ssl/' + host + '.crt');
    } catch (e) {}

    const options = {
        key: key,
        cert: cert,
        rejectUnauthorized: false
    };

    const client = tls.connect(port, host, options);
    client.__host = host;

    return client;
}

/**
 * @param config
 * @param callback
 */
function runDaemon(config, callback) {
    const whaler = this;
    const client = createClient(config.host);

    if (!client) {
        whaler.emit('rsync:daemon', {
            ref: config.ref,
            volume: config.volume
        }, (err, response) => {
            if (err) {
                return callback(err);
            }
            response['host'] = process.env.WHALER_DOCKER_IP || '172.17.0.1';
            callback(null, response);
        });

        return;
    }

    client.on('error', (err) => {
        callback(err);
    });

    let response = null;
    client.on('connect', () => {
        client.on('data', (data) => {
            try {
                const json = JSON.parse(data.toString());
                response = json;
            } catch (e) {
                process.stdout.write(data);
            }
        });
        client.write(JSON.stringify({
            name: 'whaler_rsync',
            argv: [
                'rsync:daemon',
                config.ref,
                config.volume || ''
            ]
        }));
    });

    client.on('end', () => {
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
}

/**
 * @param config
 * @param callback
 */
function killDaemon(config, callback) {
    const whaler = this;

    if (config.remote) {
        const client = createClient(config.remote);

        client.on('error', (err) => {
            callback(err);
        });

        client.on('connect', () => {
            client.on('data', (data) => {
                process.stdout.write(data);
            });
            client.write(JSON.stringify({
                name: 'whaler_rsync',
                argv: [
                    'rsync:kill',
                    config.container
                ]
            }));
        });

        client.on('end', () => {
            callback(null);
        });

        return;
    }

    whaler.emit('rsync:kill', {
        container: config.container
    }, callback);
}
