'use strict';

module.exports = cmd;

/**
 * @param whaler
 */
async function cmd (whaler) {

    (await whaler.fetch('cli')).default

        .command('rsync <source> <destination>')
        //.alias('sync')
        .description('Synchronize application volumes', {
            source: 'Source',
            destination: 'Destination'
        })
        .option('--dry-run', 'Perform a trial run with no changes made')
        .option('--delete', 'Delete extraneous files from destination dirs')
        .action(async (source, destination, options, util) => {
            await whaler.emit('rsync', {
                src: preparePath(util, source),
                dst: preparePath(util, destination),
                delete: options.delete || false,
                dryRun: options.dryRun || false,
                followPull: true
            });
        });

}

/**
 * @param util
 * @param value
 * @returns {String}
 */
function preparePath (util, value) {
    if (value.indexOf('@') > -1) {
        const values = value.split('@');
        values[0] = util.prepare('ref', values[0]);
        return values.join('@');
    }
    return util.prepare('path', value);
}
