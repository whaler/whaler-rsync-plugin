'use strict';

var Q = require('q');

var addCmd = function(whaler) {
    var console = whaler.require('./lib/console');

    whaler.cli.command(
        'rsync-kill <container>'
    ).description(
        'Kill rsync daemon'
    ).action(function(container, options) {

            var opts = {
                container: container
            };

            whaler.events.emit('rsync-kill', opts, function(err) {
                console.log('');
                if (err) {
                    return console.error('[%s] %s', process.pid, err.message, '\n');
                }
            });

        }).on('--help', function() {
            whaler.cli.argumentsHelp(this, {
                'container': 'Rsync container name'
            });
        });
};

module.exports = function(whaler) {

    addCmd(whaler);

    var containerRemove = Q.denodeify(function(container, opts, callback) {
        container.remove(opts, callback);
    });

    whaler.events.on('rsync-kill', function(options, callback) {
        var promise = Q.async(function*() {
            if (0 !== options['container'].indexOf('whaler_rsync-daemon-')) {
                throw new Error('Error');
            }

            var container = whaler.docker.getContainer(options['container']);

            yield containerRemove(container, {
                v: true,
                force: true
            });

        })();

        promise.done(function() {
            callback(null);
        }, function(err) {
            callback(err);
        });
    });
};
