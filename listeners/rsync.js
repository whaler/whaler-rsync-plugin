'use strict';

const fs = require('fs');
const tls = require('tls');
const path = require('path');
const util = require('util');
const fsLstat = util.promisify(fs.lstat);
const fsExists = util.promisify(fs.exists);
const rsyncContainer = require('../lib/container');

module.exports = exports;

/**
 * @param whaler
 */
async function exports (whaler) {

    whaler.on('rsync', async ctx => {
        const src = parseArgs(ctx.options['src']);
        const dst = parseArgs(ctx.options['dst']);

        const { default: docker } = await whaler.fetch('docker');

        const stage = {
            container: null,
            remote: {}
        };

        let err = null;

        whaler.before('SIGINT', async ctx => {
            await exit(ctx.options, stage);
        });

        if ('local' === rsyncType(src) && 'local' === rsyncType(dst)) {
            throw new Error('not supported');
        }

        const followPull = ctx.options['followPull'] || false;
        await rsyncContainer.pullImage(docker, followPull);

        if (followPull) {
            whaler.info('Rsync %s -> %s', ctx.options['src'], ctx.options['dst']);
        }

        try {
            if ('remote' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                stage.container = await rsyncContainer(docker, {
                    ref: 'rsync-' + Math.floor(new Date().getTime() / 1000)
                });
                const info = await stage.container.inspect();

                const mounts = info['Mounts'];
                for (let mount of mounts) {
                    if ('/volume' == mount['Destination']) {

                        whaler.warn('Rsync %s -> %s', ctx.options['src'], 'tmp@local');

                        await whaler.emit('rsync', {
                            src: ctx.options['src'],
                            dst: mount['Source'],
                            delete: ctx.options['delete'] || false,
                            dryRun: ctx.options['dryRun'] || false
                        });

                        whaler.warn('Rsync %s -> %s', 'tmp@local', ctx.options['dst']);

                        await whaler.emit('rsync', {
                            src: mount['Source'],
                            dst: ctx.options['dst'],
                            delete: ctx.options['delete'] || false,
                            dryRun: ctx.options['dryRun'] || false
                        });
                    }
                }

            } else {

                if ('local' === rsyncType(src) && 'remote' === rsyncType(dst)) {
                    const dstConf = stage.remote['dst'] = await runDaemon(ctx.options['dst'], dst);

                    let cmd = makeCmd(ctx.options);
                    if (await fsExists(src + '/.rsyncignore')) {
                        cmd.push('--exclude-from=/volume/.rsyncignore'); // rsync ignore
                    }

                    const stat = await fsLstat(src);
                    if (stat.isDirectory()) {
                        cmd.push('/volume/');
                    } else {
                        cmd.push('/volume/' + path.basename(src));
                    }

                    cmd.push(generateRsync(dstConf));

                    console.log('');
                    stage.container = await rsyncContainer(docker, {
                        src: stat.isDirectory() ? src : path.dirname(src),
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + dstConf.password
                        ]
                    });

                } else {
                    const srcConf = stage.remote['src'] = await runDaemon(ctx.options['src'], src);

                    let cmd = makeCmd(ctx.options);
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
                    stage.container = await rsyncContainer(docker, {
                        src: dst,
                        cmd: cmd,
                        env: [
                            'RSYNC_PASSWORD=' + srcConf.password
                        ]
                    });
                }

                await stage.container.start({});
                const stream = await stage.container.logs({
                    follow: true,
                    stdout: true,
                    stderr: true
                });

                await writeLogs(stream);
            }

        } catch (e) {
            err = e;
        }

        await exit(ctx.options, stage);

        if (err) {
            throw err;
        }
    });

    // PRIVATE

    /**
     * @param options
     * @param stage
     */
    const exit = async (options, stage) => {
        if (stage.container) {
            const container = stage.container;
            stage.container = null;

            try {
                await container.remove({
                    force: true,
                    v: true
                });
            } catch (e) {}
        }

        for (let key of Object.keys(stage.remote)) {
            const config = stage.remote[key];
            delete stage.remote[key];

            try {
                whaler.warn('Killing "%s" rsync daemon', options[key]);
                if (config.remote) {
                    await killRemoteDaemon(config);
                } else {
                    await whaler.emit('rsync:kill', { container: config.container });
                }
            } catch (e) {}
        }
    };

    /**
     * @param name
     * @param config
     */
    const runDaemon = async (name, config) => {
        whaler.warn('Running "%s" rsync daemon', name);

        if (isLocal(config.host)) {
            const response = await whaler.emit('rsync:daemon', {
                ref: config.ref,
                volume: config.volume
            });
            response['host'] = process.env.WHALER_DOCKER_IP || '172.17.0.1';

            return response;
        }

        return await runRemoteDaemon(config);
    };
}

// PRIVATE

/**
 * @param config
 */
const killRemoteDaemon = util.promisify((config, callback) => {
    const client = createClient(config.remote);

    client.on('error', err => {
        callback(err);
    });

    client.on('connect', () => {
        client.on('data', data => {
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
});

/**
 * @param config
 */
const runRemoteDaemon = util.promisify((config, callback) => {
    const client = createClient(config.host);

    client.on('error', err => {
        callback(err);
    });

    let response = null;
    client.on('connect', () => {
        client.on('data', data => {
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
});

/**
 * @param stream
 */
const writeLogs = util.promisify((stream, callback) => {
    stream.setEncoding('utf8');
    stream.on('data', data => {
        process.stdout.write(data);
    });
    stream.on('end', () => {
        callback(null);
    });
});

/**
 * @param options
 * @returns {string[]}
 */
function makeCmd (options) {
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
function generateRsync (config) {
    return 'rsync://'+ config.username + '@' + config.host + ':' + config.port + '/data';
}

/**
 * @param value
 * @returns {*}
 */
function parseArgs (value) {
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

    return value;
}

/**
 * @param value
 * @returns {string}
 */
function rsyncType (value) {
    return 'string' === typeof value ? 'local' : 'remote';
}

/**
 * @param host
 * @returns {boolean}
 */
function isLocal (host) {
    const parts = host.split(':');
    if (parts.length > 1) {
        host = parts[0];
    }
    return ['127.0.0.1', 'localhost', 'whaler'].includes(host);
}

/**
 * @param host
 */
function createClient (host) {
    let port = 1337;

    const parts = host.split(':');
    if (parts.length > 1) {
        host = parts[0];
        port = parts[1];
    }

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
