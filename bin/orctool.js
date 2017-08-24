#!/usr/bin/env node

'use strict';

const pem = require('pem');
const { utils: keyutils } = require('kad-spartacus');
const orc = require('../lib');
const options = require('./config');
const program = require('commander');


program.version(`
  orctool  ${orc.version.software}
  protocol ${orc.version.protocol}
`);

program.description(`
  Copyright (c) 2017 Gordon Hall
  Licensed under the GNU Affero General Public License Version 3
`);

program
  .command('generate-key')
  .description('generate a private extended node identity key')
  .option('-x, --extended [hex_seed]', 'generate private extended key', true)
  .option('--convert <hex_secp256k1>', 'generate private extended key')
  .action(function(env) {
    if (env.convert) {
      console.info(keyutils.toExtendedFromPrivateKey(
        Buffer.from(env.convert, 'hex')
      ));
    } else if (env.extended) {
      console.info(keyutils.toHDKeyFromSeed(
        typeof env.extended === 'string'
          ? Buffer.from(env.extended, 'hex')
          : undefined
      ).privateExtendedKey);
    }
  });

program
  .command('generate-cert')
  .description('generate a new self-signed certificate and key')
  .option('-d, --days <days_valid>', 'number of days certificate is valid')
  .action(function(env) {
    pem.createCertificate({
      selfSigned: true,
      days: parseInt(env.days || 365)
    }, (err, data) => {
      if (err) {
        console.error(`\n  ${err.message}\n`);
      } else {
        console.info(`${data.serviceKey}\r\n\r\n${data.certificate}`);
      }
    });
  });

program
  .command('generate-onion')
  .description('generate a new onion hidden service RSA1024 private key')
  .action(function() {
    pem.createPrivateKey(1024, (err, data) => {
      if (err) {
        console.error(`\n ${err.message}`);
      } else {
        console.info(data.key);
      }
    });
  });

program
  .command('list-config-options')
  .description('print all valid configuration option names')
  .action(function() {
    for (let prop in options) {
      console.info(prop);
    }
  });

program.command('*').action(() => program.help());
program.parse(process.argv);

if (process.argv.length < 3) {
  program.help();
}

