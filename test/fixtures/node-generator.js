'use strict';

const { tmpdir } = require('os');
const { randomBytes } = require('crypto');
const async = require('async');
const pem = require('pem');
const path = require('path');
const bunyan = require('bunyan');
const orc = require('../..');
const mkdirp = require('mkdirp');
const getDatabase = require('./database');

let startPort = 45000;


module.exports = function(numNodes, callback) {

  const nodes = [];

  getDatabase((err, database) => {
    if (err) {
      return callback(err);
    }

    function createNode(callback) {
      const shardsPath = path.join(
        tmpdir(),
        `orc.integration-${randomBytes(6).toString('hex')}`
      );

      mkdirp.sync(shardsPath);

      const logger = bunyan.createLogger({
        levels: ['fatal'],
        name: 'node-kademlia'
      });
      const contact = {
        hostname: 'localhost',
        port: startPort++,
        protocol: 'https:'
      };
      const shards = new orc.Shards(shardsPath, {
        maxSpaceAllocated: 1024 * 1024 * 1024
      });

      pem.createCertificate({ days: 1, selfSigned: true }, function(err, keys) {
        const transport = new orc.Transport({
          key: keys.serviceKey,
          cert: keys.certificate
        });

        callback(new orc.Node({
          contact,
          database,
          shards,
          logger,
          transport
        }));
      });
    }

    async.times(numNodes, function(n, done) {
      createNode((node) => {
        nodes.push(node);
        done();
      });
    }, () => callback(nodes));
  });
};
