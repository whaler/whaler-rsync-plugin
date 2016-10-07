'use strict';

var console = require('x-console');

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
        .option('--dry-run', 'Perform a trial run with no changes made')
        .option('--delete', 'Delete extraneous files from destination dirs')
        .action(function* (source, destination, options) {
            yield whaler.$emit('rsync', {
                src: source,
                dst: destination,
                delete: options.delete || false,
                dryRun: options.dryRun || false,
                followPull: true
            });
        });

}
