'use strict';

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.get('cli')
        .command('rsync <source> <destination>')
        //.alias('sync')
        .description('Synchronize application volumes', {
            source: 'Source',
            destination: 'Destination'
        })
        .action(function* (source, destination, options) {
            process.env.WHALER_DOCKER_PROGRESS = 'quiet';

            yield whaler.$emit('rsync', {
                src: source,
                dst: destination
            });
        });

}
