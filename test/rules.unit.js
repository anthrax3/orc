'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const crypto = require('crypto');
const { randomBytes } = crypto;
const { utils: keyutils } = require('kad-spartacus');
const { Readable, Transform } = require('stream');
const { EventEmitter } = require('events');
const utils = require('../lib/utils');
const AuditStream = require('../lib/audit');
const ProofStream = require('../lib/proof');
const Rules = require('../lib/rules');


describe('@class Rules', function() {

  function createValidContract() {
    const renterHdKey = keyutils.toHDKeyFromSeed().deriveChild(1);
    const farmerHdKey = keyutils.toHDKeyFromSeed().deriveChild(1);
    const contract = new Contract({
      renter_id: keyutils.toPublicKeyHash(renterHdKey.publicKey)
                   .toString('hex'),
      farmer_id: keyutils.toPublicKeyHash(farmerHdKey.publicKey)
                   .toString('hex'),
      renter_hd_key: renterHdKey.publicExtendedKey,
      farmer_hd_key: farmerHdKey.publicExtendedKey,
      renter_hd_index: 1,
      farmer_hd_index: 1,
      payment_destination: '14WNyp8paus83JoDvv2SowKb3j1cZBhJoV',
      data_hash: crypto.createHash('rmd160').update('test').digest('hex')
    });
    contract.sign('renter', renterHdKey.privateKey);
    contract.sign('farmer', farmerHdKey.privateKey);
    contract._farmerPrivateKey = farmerHdKey.privateKey;
    contract._renterPrivateKey = renterHdKey.privateKey;
    return contract;
  }

  describe('@method audit', function() {

    let auditStream = null;
    let dataShard = Buffer.from('this is a test shard');

    before(function(done) {
      auditStream = new AuditStream(2);
      auditStream.on('finish', done).end(dataShard);
    });

    it('should callback error if invalid audit batch', function(done) {
      const rules = new Rules({});
      const request = {
        params: {},
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.audit(request, response, (err) => {
        expect(err.message).to.equal('Invalid audit batch supplied');
        done();
      });
    });

    it('should return null if cannot load contract', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, new Error('Not found'))
        }
      });
      const request = {
        params: [
          { hash: 'datahash', challenge: 'challengerequest' }
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(params[0].hash).to.equal('datahash');
          expect(params[0].proof).to.equal(null);
          done();
        }
      };
      rules.audit(request, response, done);
    });

    it('should return null if cannot load shard', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, { data_hash: 'datahash'})
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(
            1,
            new Error('Not found')
          )
        }
      });
      const request = {
        params: [
          { hash: 'datahash', challenge: 'challengerequest' }
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(params[0].hash).to.equal('datahash');
          expect(params[0].proof).to.equal(null);
          done();
        }
      };
      rules.audit(request, response, done);
    });

    it('should return null if proof fails', function(done) {
      const shardParts = [dataShard];
      const readStream = new Readable({
        read: function() {
          if (shardParts.length) {
            this.push(shardParts.shift());
          } else {
            this.push(null);
          }
        }
      });
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {
            data_hash: 'datahash',
            audit_leaves: auditStream.getPublicRecord()
          })
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, null, readStream)
        }
      });
      const request = {
        params: [{ hash: 'datahash', challenge: '00000000' }],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(params[0].proof).to.equal(null);
          done();
        }
      };
      rules.audit(request, response);
    });

    it('should return { hash, proof } if successful', function(done) {
      const shardParts = [dataShard];
      const readStream = new Readable({
        read: function() {
          if (shardParts.length) {
            this.push(shardParts.shift());
          } else {
            this.push(null);
          }
        }
      });
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {
            data_hash: 'datahash',
            audit_leaves: auditStream.getPublicRecord()
          })
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, null, readStream)
        }
      });
      const request = {
        params: [
          {
            hash: 'datahash',
            challenge: auditStream.getPrivateRecord().challenges[0]
          }
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          let { proof } = params[0];
          let { root, depth } = auditStream.getPrivateRecord();
          let [expected, actual] = ProofStream.verify(proof, root, depth);
          expect(Buffer.compare(expected, actual)).to.equal(0);
          done();
        }
      };
      rules.audit(request, response);
    });

  });

  describe('@method consign', function() {

    it('should callback error if cannot load contract', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, new Error('Not found'))
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.consign(request, response, (err) => {
        expect(err.message).to.equal('Not found');
        done();
      })
    });

    it('should callback error if contract is expired', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {
            store_end: 0
          })
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.consign(request, response, (err) => {
        expect(err.message).to.equal('Contract has expired');
        done();
      });
    });

    it('should create a token and respond with it', function(done) {
      const accept = sinon.stub();
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {
            store_end: Infinity
          })
        },
        server: {
          accept: accept
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(typeof params[0]).to.equal('string');
          expect(accept.calledWithMatch(params[0])).to.equal(true);
          done();
        }
      };
      rules.consign(request, response, done);
    });

  });

  describe('@method mirror', function() {

    it('should callback error if contract cannot load', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, new Error('Not found'))
        }
      });
      const request = {
        params: [
          utils.rmd160sha256('shard'),
          'token',
          ['identity', { xpub: 'xpub' }]
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.mirror(request, response, (err) => {
        expect(err.message).to.equal('Not found');
        done();
      });
    });

    it('should callback error if shard stream cannot open', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null)
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, new Error('Failed'))
        }
      });
      const request = {
        params: [
          utils.rmd160sha256('shard'),
          'token',
          ['identity', { xpub: 'xpub' }]
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.mirror(request, response, (err) => {
        expect(err.message).to.equal('Failed');
        done();
      });
    });

    it('should callback error if upload fails', function(done) {
      const StubbedRules = proxyquire('../lib/rules', {
        './utils': {
          rmd160: utils.rmd160,
          createShardUploader: () => {
            return new Transform({
              transform: (chunk, enc, cb) => {
                cb(new Error('Upload failed'));
              }
            })
          }
        }
      });
      const parts = [Buffer.from('hello'), null];
      const rs = new Readable({
        read: function() {
          this.push(parts.shift());
        }
      });
      const rules = new StubbedRules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null)
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, null, rs)
        }
      });
      const request = {
        params: [
          utils.rmd160sha256('shard'),
          'token',
          ['identity', { xpub: 'xpub' }]
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.mirror(request, response, (err) => {
        expect(err.message).to.equal('Upload failed');
        done();
      });
    });

    it('should respond error if uploader fails', function(done) {
      const uploader = new Transform({ transform: (chunk, enc, cb) => cb() });
      const StubbedRules = proxyquire('../lib/rules', {
        './utils': {
          rmd160: utils.rmd160,
          createShardUploader: () => {
            return uploader;
          }
        }
      });
      const parts = [Buffer.from('hello'), null];
      const rs = new Readable({
        read: function() {
          this.push(parts.shift());
        }
      });
      const rules = new StubbedRules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null)
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, null, rs)
        }
      });
      const request = {
        params: [
          utils.rmd160sha256('shard'),
          'token',
          ['identity', { xpub: 'xpub' }]
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.mirror(request, response, (err) => {
        expect(err.message).to.equal('Not authorized');
        done();
      });
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = 401;
        uploader.emit('response', res);
        setImmediate(() => {
          res.emit('data', 'Not authorized');
          res.emit('end');
        });
      });
    });

    it('should respond acknowledgement if upload succeeds', function(done) {
      const uploader = new Transform({ transform: (chunk, enc, cb) => cb() });
      const StubbedRules = proxyquire('../lib/rules', {
        './utils': {
          rmd160: utils.rmd160,
          createShardUploader: () => {
            return uploader;
          }
        }
      });
      const parts = [Buffer.from('hello'), null];
      const rs = new Readable({
        read: function() {
          this.push(parts.shift());
        }
      });
      const rules = new StubbedRules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null)
        },
        shards: {
          createReadStream: sinon.stub().callsArgWith(1, null, rs)
        }
      });
      const request = {
        params: [
          utils.rmd160sha256('shard'),
          'token',
          ['identity', { xpub: 'xpub' }]
        ],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(params).to.have.lengthOf(1);
          done();
        }
      };
      rules.mirror(request, response, done);
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        uploader.emit('response', res);
        setImmediate(() => res.emit('end'));
      });
    });

  });

  describe('@method retrieve', function() {

    it('should callback error if contract cannot load', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, new Error('Not found'))
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.retrieve(request, response, (err) => {
        expect(err.message).to.equal('Not found');
        done();
      });
    });

    it('should callback error if shard data not found', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {})
        },
        shards: {
          exists: sinon.stub().callsArgWith(1, null, false)
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.retrieve(request, response, (err) => {
        expect(err.message).to.equal('Shard not found');
        done();
      });
    });

    it('should create token and respond with it', function(done) {
      const accept = sinon.stub();
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, {})
        },
        shards: {
          exists: sinon.stub().callsArgWith(1, null, true)
        },
        server: {
          accept: accept
        }
      });
      const request = {
        params: ['datahash'],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(typeof params[0]).to.equal('string');
          expect(accept.calledWithMatch(params[0])).to.equal(true);
          done();
        }
      };
      rules.retrieve(request, response, done);
    });

  });

  describe('@method renew', function() {

    it('should callback error if contract invalid', function(done) {
      const rules = new Rules();
      const request = {
        params: [{}],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.renew(request, response, (err) => {
        expect(err.message).to.equal('Descriptor is invalid or incomplete');
        done();
      });
    });

    it('should callback error if cannot load contract', function(done) {
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, new Error('Not found'))
        }
      });
      const request = {
        params: [createValidContract().toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.renew(request, response, (err) => {
        expect(err.message).to.equal('Not found');
        done();
      });
    });

    it('should callback error if restricted property', function(done) {
      const c1 = createValidContract();
      const c2 = createValidContract();
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, c2.toObject())
        }
      });
      const request = {
        params: [c1.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.renew(request, response, (err) => {
        expect(err.message).to.equal('Rejecting renewal of farmer_hd_key');
        done();
      });
    });

    it('should callback error if cannot update local record', function(done) {
      const c1 = createValidContract();
      const c2 = Contract.from(c1.toObject());
      c2.set('store_end', 0);
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, c2.toObject()),
          put: sinon.stub().callsArgWith(2, new Error('Failed to write'))
        },
        spartacus: {
          privateKey: randomBytes(32)
        }
      });
      const request = {
        params: [c1.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.renew(request, response, (err) => {
        expect(err.message).to.equal('Failed to write');
        done();
      });
    });

    it('should sign and echo back the renewal', function(done) {
      const c1 = createValidContract();
      const c2 = Contract.from(c1.toObject());
      c1.set('store_end', 0);
      const rules = new Rules({
        contracts: {
          get: sinon.stub().callsArgWith(1, null, c2.toObject()),
          put: sinon.stub().callsArgWith(2, null)
        },
        spartacus: {
          privateKey: randomBytes(32)
        }
      });
      const request = {
        params: [c1.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          expect(params[0].store_end).to.equal(0);
          done();
        }
      };
      rules.renew(request, response, done);
    });

  });

  describe('@method claim', function() {

    it('should callback error if claims are disabled', function(done) {
      const contract = createValidContract();
      const rules = new Rules({
        claims: []
      });
      const request = {
        params: [contract.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.claim(request, response, (err) => {
        expect(err.message).to.equal('Currently rejecting claims');
        done();
      });
    });

    it('should callback error if contract is invalid', function(done) {
      const contract = createValidContract();
      contract.set('data_hash', null);
      const rules = new Rules({
        claims: ['*'],
        identity: randomBytes(20),
        contact: {
          xpub: 'xpub',
          index: 0
        },
        spartacus: {
          privateKey: randomBytes(32)
        }
      });
      const request = {
        params: [contract.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.claim(request, response, (err) => {
        expect(err.message).to.equal('Invalid shard descriptor');
        done();
      });
    });

    it('should callback error if cannot save', function(done) {
      const contract = createValidContract();
      const rules = new Rules({
        claims: ['*'],
        identity: randomBytes(20),
        contact: {
          xpub: contract.get('farmer_hd_key'),
          index: contract.get('farmer_hd_index')
        },
        spartacus: {
          privateKey: contract._farmerPrivateKey
        },
        contracts: {
          put: sinon.stub().callsArgWith(2, new Error('Failed to save'))
        }
      });
      const request = {
        params: [contract.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {};
      rules.claim(request, response, (err) => {
        expect(err.message).to.equal('Failed to save');
        done();
      });
    });

    it('should respond with descriptor and token', function(done) {
      const contract = createValidContract();
      const accept = sinon.stub();
      const rules = new Rules({
        claims: [contract.get('renter_hd_key')],
        identity: randomBytes(20),
        contact: {
          xpub: contract.get('farmer_hd_key'),
          index: contract.get('farmer_hd_index')
        },
        spartacus: {
          privateKey: contract._farmerPrivateKey
        },
        contracts: {
          put: sinon.stub().callsArg(2)
        },
        server: {
          accept: accept
        }
      });
      const request = {
        params: [contract.toObject()],
        contact: [
          'identity',
          { xpub: 'xpubkey' }
        ]
      };
      const response = {
        send: (params) => {
          const c = Contract.from(params[0]);
          expect(c.isValid()).to.equal(true);
          expect(c.isComplete()).to.equal(true);
          expect(accept.calledWithMatch(params[1], contract.get('data_hash'),
                                        request.contact));
          done();
        }
      };
      rules.claim(request, response, done);
    });

  });

});
