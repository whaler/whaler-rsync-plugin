'use strict';

module.exports = rsyncContainer;

function* rsyncContainer(docker, options) {
    const image = 'cravler/rsync';
    try {
        yield docker.followPull.$call(docker, image);
    } catch (e) {}

    const createOpts = {
        'name': 'whaler_' + (options['ref'] ? options['ref'] + '_' : '') + process.pid,
        'Image': image,
        'Tty': true,
        'Env': options['env'] || [],
        'Volumes': {
            '/volume': {}
        },
        'ExposedPorts': {
            '873/tcp': {}
        },
        'HostConfig': {
            'PortBindings': {
                '873/tcp': [
                    {
                        'HostIp': '',
                        'HostPort': ''
                    }
                ]
            }
        }
    };

    if (options['src']) {
        createOpts['HostConfig']['Binds'] = [
            options['src'] + ':/volume'
        ];
    }

    if (options['cmd']) {
        createOpts['Cmd'] = options['cmd'];
    }

    return yield docker.createContainer.$call(docker, createOpts);
}
