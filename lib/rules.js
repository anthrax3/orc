'use strict';

const { randomBytes } = require('crypto');
const async = require('async');
const utils = require('./utils');
const Contract = require('./contract');
const ProofStream = require('./proof');


/**
 * Represents Orc protocol handlers
 */
class Rules {

  /**
   * Constructs a Orc rules instance in the context of a Orc node
   * @constructor
   * @param {Node} node
   */
  constructor(node) {
    this.node = node;
  }

  /**
   * Upon receipt of an OFFER message, nodes must validate the descriptor,
   * then ensure that the referenced shard is awaiting allocation(s). If both
   * checks succeed, then the descriptor is added to the appropriate offer
   * processing stream. Once the descriptor is processed, we respond back to
   * the originator with the final copy of the contract.
   * @param {object} request
   * @param {object} response
   */
  offer(request, response, next) {
    const [descriptor] = request.params;
    const contract = Contract.from(descriptor);
    const shardKey = contract.get('data_hash');
    const offerStream = this.node.offers.get(shardKey);

    if (!(contract.isValid() && contract.isComplete())) {
      return next(new Error('Invalid shard descriptor'));
    }

    if (!offerStream) {
      return next(new Error('Offers for descriptor are closed'));
    }

    offerStream.queue(request.contact, contract, (err, result) => {
      if (err) {
        return next(err);
      }

      response.send([result]);
    });
  }

  /**
   * Upon receipt of a AUDIT message, the node must look up the contract that
   * is associated with each hash-challenge pair in the payload, prepend the
   * challenge to the shard data, and caclulate the resulting hash, formatted
   * as a compact proof. See {@tutorial compact-proofs}.
   * @param {object} request
   * @param {object} response
   */
  audit(request, response, next) {
    const audits = request.params;
    const [, { xpub }] = request.contact;

    if (!Array.isArray(audits)) {
      return next(new Error('Invalid audit batch supplied'));
    }

    async.mapSeries(audits, ({ hash, challenge }, done) => {
      this.node.contracts.get(`${hash}:${xpub}`, (err, desc) => {
        if (err) {
          return done(null, { hash, proof: null });
        }

        const contract = Contract.from(desc);
        const auditLeaves = contract.get('audit_leaves');
        const proofStream = new ProofStream(auditLeaves, challenge);

        proofStream.on('error', () => {
          proofStream.removeAllListeners('finish');
          done(null, { hash, proof: null });
        });

        proofStream.on('finish', () => {
          proofStream.removeAllListeners('error');
          done(null, { hash, proof: proofStream.getProofResult() });
        });

        this.node.shards.createReadStream(hash, (err, shardStream) => {
          if (err) {
            return done(null, { hash, proof: null });
          }

          shardStream.pipe(proofStream);
        });
      });
    }, (err, proofs) => response.send(proofs));
  }

  /**
   * Upon receipt of a CONSIGN message, the node must verify that it has a
   * valid storage allocation and contract for the supplied hash and identity
   * of the originator. If so, it must generate an authorization token which
   * will be checked by the shard server before accepting the transfer of the
   * associated shard.
   * @param {object} request
   * @param {object} response
   */
  consign(request, response, next) {
    const [hash] = request.params;
    const { contact } = request;

    this.node.contracts.get(`${hash}:${contact[1].xpub}`, (err, desc) => {
      if (err) {
        return next(err);
      }

      const now = Date.now();
      const contract = Contract.from(desc);
      const token = randomBytes(32).toString('hex');

      if (now > contract.get('store_end')) {
        return next(new Error('Contract has expired'));
      }

      this.node.server.accept(token, hash, contact);
      response.send([token]);
    });
  }

  /**
   * Upon receipt of a MIRROR message, the node must verify that it is in
   * possesion of the shard on behalf of the identity or the message
   * originator. If so, given the token-hash pair, it must attempt to upload
   * it's copy of the shard to the target to establish a mirror.
   * @param {object} request
   * @param {object} response
   */
  mirror(request, response, next) {
    const [hash, token, target] = request.params;
    const { contact } = request;

    this.node.contracts.get(`${hash}:${contact[1].xpub}`, (err) => {
      if (err) {
        return next(err);
      }

      this.node.shards.createReadStream(hash, (err, shardStream) => {
        if (err) {
          return next(err);
        }

        const uploader = utils.createShardUploader(target, hash, token);

        uploader.on('response', (res) => {
          let result = '';

          res.on('data', (data) => result += data.toString());
          res.on('end', () => {
            if (res.statusCode !== 200) {
              return next(new Error(result));
            }

            response.send([result]);
          });
        });

        shardStream.pipe(uploader).once('error', next);
      });
    });
  }

  /**
   * Upon receipt of a RETRIEVE message, the node must verify that it is in
   * possession of the shard on behalf of the identity of the originator.
   * If so, it must generate an authorization token which will be checked by
   * the shard server before accepting the transfer of the associated shard.
   * @param {object} request
   * @param {object} response
   */
  retrieve(request, response, next) {
    const [hash] = request.params;
    const { contact } = request;

    this.node.contracts.get(`${hash}:${contact[1].xpub}`, (err) => {
      if (err) {
        return next(err);
      }

      const token = randomBytes(32).toString('hex');

      this.node.shards.exists(hash, (err, exists) => {
        if (err || !exists) {
          return next(err || new Error('Shard not found'));
        }

        this.node.server.accept(token, hash, contact);
        response.send([token]);
      });
    });
  }

  /**
   * Upon receipt of a PROBE message, the node must attempt to send a PING
   * message to the originator using the declared contact information. If
   * successful, it must respond positively, otherwise error.
   * @param {object} request
   * @param {object} response
   */
  probe(request, response, next) {
    this.node.ping(request.contact, (err) => {
      if (err) {
        return next(new Error('Failed to reach probe originator'));
      }

      response.send([]);
    });
  }

  /**
   * Upon receipt of a RENEW message, the recipient farmer must extend or
   * terminate it's contract based on the new terms supplied by the renter.
   * If the renewal descriptor is valid and complete, the farmer must store
   * the updated version after signing and respond back to the originator
   * with the version containing the updated signature.
   * @param {object} request
   * @param {object} response
   */
  renew(request, response, next) {
    const [descriptor] = request.params;
    const renewal = Contract.from(descriptor);
    const hash = renewal.get('data_hash');
    const [, { xpub }] = request.contact;
    const key = `${hash}:${xpub}`;

    if (!(renewal.isValid() && renewal.isComplete())) {
      return next(new Error('Descriptor is invalid or incomplete'));
    }

    this.node.contracts.get(key, (err, desc) => {
      if (err) {
        return next(err);
      }

      const allowed = [
        'renter_id',
        'renter_hd_key',
        'renter_signature',
        'store_begin',
        'store_end',
        'audit_leaves'
      ];
      const original = Contract.from(desc);
      const difference = Contract.diff(original, renewal);

      for (let prop of difference) {
        if (!allowed.includes(prop)) {
          return next(new Error(`Rejecting renewal of ${prop}`));
        }
      }

      renewal.sign('farmer', this.node.spartacus.privateKey);
      this.node.contracts.put(key, renewal.toObject(), (err) => {
        if (err) {
          return next(err);
        }

        response.send([renewal.toObject()]);
      });
    });
  }

  /**
   * Upon receipt of an `CLAIM` message, nodes must validate the descriptor,
   * then ensure that there is enough available space for the shard. If both
   * checks succeed, then the descriptor is signed and returned along with a
   * consignment token so the initiating renter can immediately upload the
   * data. This call is the functional inverse of `OFFER`, as it is used for a
   * renter to signal to a farmer that it wishes to rent capacity. These
   * messages are generally sent based on information collected when subscribed
   * to farmer capacity publications.
   * @param {object} request
   * @param {object} response
   */
  claim(request, response, next) {
    const [descriptor] = request.params;
    const contract = Contract.from(descriptor);
    const xpub = contract.get('renter_hd_key');
    const hash = contract.get('data_hash');

    if (!this.node.claims.includes(xpub) && !this.node.claims.includes('*')) {
      return next(new Error('Currently rejecting claims'));
    }

    contract.set('payment_destination', '?'); // TODO: z_getnewaddress here
    contract.set('farmer_id', this.node.identity.toString('hex'));
    contract.set('farmer_hd_key', this.node.contact.xpub);
    contract.set('farmer_hd_index', this.node.contact.index);
    contract.sign('farmer', this.node.spartacus.privateKey);

    if (!(contract.isValid() && contract.isComplete())) {
      return next(new Error('Invalid shard descriptor'));
    }

    this.node.contracts.put(`${hash}:${xpub}`, contract.toObject(), (err) => {
      if (err) {
        return next(err);
      }

      const token = randomBytes(32).toString('hex');

      this.node.server.accept(token, hash, request.contact);
      response.send([contract.toObject(), token]);
    });
  }

}

module.exports = Rules;
