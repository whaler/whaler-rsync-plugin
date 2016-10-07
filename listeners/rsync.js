'use strict';

var fs = require('fs');
var tls = require('tls');
var path = require('path');
var console = require('x-console');

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.on('rsync', function* (options) {
        const src = parseArgs(options['src']);
        const dst = parseArgs(options['dst']);

        const docker = whaler.get('docker');

        const stage = {
            container: null,
            remote: {}
        };

        let err = null;

        whaler.before('SIGINT', function* () {
            yield exit.$call(whaler, options, stage);
        });

        if ('local' === rsyncType(src) && 'local' === rsyncType(dst)) {
            throw new Error('not supported');
        }

        const followPull = options['followPull'] || false;
        const rsyncContainer = require('../lib/container');

        yield rsyncContainer.pullImage.$call(docker, followPull);

        if (followPull) {
            console.info('');
            console.info('[%s] Rsync %s -> %s', process.pid, parsePath(options['src']), parsePath(options['dst']));
        }

        try {
            if ('remote' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                stage.container = yield rsyncContainer.$call(docker, {
                    ref: 'rsync-' + Math.floor(new Date().getTime() / 1000)
                });
                const info = yield stage.container.inspect.$call(stage.container);

                const mounts = info['Mounts'];
                for (let mount of mounts) {
                    if ('/volume' == mount['Destination']) {

                        console.warn('');
                        console.warn('[%s] Rsync %s -> %s', process.pid, options['src'], 'tmp@local');

                        yield whaler.$emit('rsync', {
                            src: options['src'],
                            dst: mount['Source'],
                            delete: options.delete || false,
                            dryRun: options.dryRun || false
                        });

                        console.warn('');
                        console.warn('[%s] Rsync %s -> %s', process.pid, 'tmp@local', options['dst']);

                        yield whaler.$emit('rsync', {
                            src: mount['Source'],
                            dst: options['dst'],
                            delete: options.delete || false,
                            dryRun: options.dryRun || false
                        });
                    }
                }

            } else {

                if ('local' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                    const dstConf = stage.remote['dst'] = yield runDaemon.$call(whaler, options['dst'], dst);

                    let cmd = makeCmd(options);
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

                    console.log('');
                    stage.container = yield rsyncContainer.$call(docker, {
                        src: stat.isDirectory() ? src : path.dirname(src),
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + dstConf.password
                        ]
                    });

                } else {
                    const srcConf = stage.remote['src'] = yield runDaemon.$call(whaler, options['src'], src);

                    let cmd = makeCmd(options);
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

                    console.log('');
                    stage.container = yield rsyncContainer.$call(docker, {
                        src: dst,
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + srcConf.password
                        ]
                    });
                }

                yield stage.container.start.$call(stage.container, {});
                const stream = yield stage.container.logs.$call(stage.container, {
                    follow: true,
                    stdout: true,
                    stderr: true
                });

                yield writeLogs.$call(null, stream);
            }

        } catch (e) {
            err = e;
        }

        yield exit.$call(whaler, options, stage);

        if (err) {
            throw err;
        }
    });
}

// PRIVATE

/**
 * @param options
 * @param stage
 */
function* exit(options, stage) {
    const whaler = this;

    if (stage.container) {
        const container = stage.container;
        stage.container = null;

        try {
            yield container.remove.$call(container, {
                force: true,
                v: true
            });
        } catch (e) {}
    }

    for (let key of Object.keys(stage.remote)) {
        const config = stage.remote[key];
        delete stage.remote[key];

        try {
            yield killDaemon.$call(whaler, options[key], config);
        } catch (e) {}
    }
}

/**
 * @param options
 * @returns {string[]}
 */
function makeCmd(options) {
    const cmd = ['rsync'];

    cmd.push('-az');              // https://download.samba.org/pub/rsync/rsync.html
    cmd.push('--numeric-ids');    // don't map uid/gid values by user/group name
    cmd.push('--human-readable'); // output numbers in a human-readable format
    cmd.push('--verbose');        // increase verbosity

    if (options.delete || false) {
        cmd.push('--delete');
    }

    if (options.dryRun || false) {
        cmd.push('--dry-run');
    }

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

    return parsePath(value);
}

/**
 * @param value
 * @returns {*}
 */
function parsePath(value) {
    if (value.indexOf('@') === -1) {
        if (!path.isAbsolute(value)) {
            value = path.join(process.cwd(), path.normalize(value));
        }
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
 * @param name
 * @param config
 * @param callback
 */
function runDaemon(name, config, callback) {
    console.warn('');
    console.warn('[%s] Running "%s" rsync daemon', process.pid, name);

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
                //process.stdout.write(data);
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
 * @param name
 * @param config
 * @param callback
 */
function killDaemon(name, config, callback) {
    const whaler = this;

    console.warn('');
    console.warn('[%s] Killing "%s" rsync daemon', process.pid, name);

    if (config.remote) {
        const client = createClient(config.remote);

        client.on('error', (err) => {
            callback(err);
        });

        client.on('connect', () => {
            client.on('data', (data) => {
                //process.stdout.write(data);
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
