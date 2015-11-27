'use strict';

var Q = require('q');

module.exports = function(whaler, options, callback) {

    var pull = Q.denodeify(whaler.docker.pull);
    var createContainer = Q.denodeify(whaler.docker.createContainer);

    var promise = Q.async(function*() {

        var image = 'cravler/rsync';
        try {
            yield pull(image);
        } catch (e) {}

        var createOpts = {
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

        var container = yield createContainer(createOpts);

        return container;
    })();

    promise.done(function(container) {
        callback(null, container);
    }, function(err) {
        callback(err);
    });
};