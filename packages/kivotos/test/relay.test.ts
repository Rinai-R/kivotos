import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { duplexPair } from "node:stream";
import { test } from "node:test";
import {
  inviteOf,
  networkOf,
  nodeIdOf,
  parseInvite,
  registrationOf,
  relayEndpoint,
} from "../src/federation.ts";
import { secureAccept, secureDial } from "../src/relay.ts";
import { createIdentity, loadIdentity } from "../src/x509.ts";

const RELAY = "relay.example.com:7443";

/** Two ends of a stream as the relay provides it: closing one end closes the other. */
function streamPair(): ReturnType<typeof duplexPair> {
  const [a, b] = duplexPair();
  a.once("close", () => b.destroy());
  b.once("close", () => a.destroy());
  return [a, b];
}

test("an invite carries the whole network, and the registration none of its secrets", () => {
  const network = networkOf(RELAY);
  const joined = parseInvite(inviteOf(network));
  assert.deepEqual(joined, network);

  // What the relay operator is given must not let the relay pose as a member.
  const registration = registrationOf(network);
  assert.equal(registration, `${network.id}.${network.token}`);
  assert.ok(!registration.includes(network.secret));
  assert.ok(!registration.includes(network.proofKey.toString("base64url")));

  const other = networkOf(RELAY);
  assert.notEqual(other.id, network.id);
  assert.notEqual(other.token, network.token);
  assert.throws(() => parseInvite("https://example.com/?relay=x&key=y"), /not a Kivotos invite/);
  assert.throws(() => networkOf(RELAY, "c2hvcnQ"), /malformed/);
});

test("relayEndpoint turns what people type into the WebSocket endpoint", () => {
  assert.equal(relayEndpoint("203.0.113.7:7443"), "ws://203.0.113.7:7443/v1/connect");
  assert.equal(relayEndpoint(" https://relay.example.com "), "wss://relay.example.com/v1/connect");
  assert.equal(relayEndpoint("wss://relay.example.com/custom"), "wss://relay.example.com/custom");
  assert.throws(() => relayEndpoint(""), /empty/);
  assert.throws(() => relayEndpoint("ftp://relay.example.com"), /must be/);
});

test("a created identity is a certificate other TLS stacks accept, and reloads to the same node", () => {
  const identity = createIdentity();
  const certificate = new X509Certificate(identity.certPem);
  assert.ok(certificate.verify(certificate.publicKey), "self-signature does not verify");
  assert.ok(new Date(certificate.validTo).getFullYear() >= 2099);
  const reloaded = loadIdentity(identity.keyPem, identity.certPem);
  assert.equal(nodeIdOf(reloaded.certDer), nodeIdOf(identity.certDer));
  assert.notEqual(nodeIdOf(createIdentity().certDer), nodeIdOf(identity.certDer));
});

test("two members of a network secure a stream and exchange bytes", async () => {
  const network = networkOf(RELAY);
  const desk = createIdentity();
  const phone = createIdentity();
  const [a, b] = streamPair();

  const [client, accepted] = await Promise.all([
    secureDial(a, network, phone, nodeIdOf(desk.certDer)),
    secureAccept(b, network, desk),
  ]);
  assert.equal(accepted.from, nodeIdOf(phone.certDer));
  assert.equal(client.getProtocol(), "TLSv1.3");

  client.write("GET / HTTP/1.1\r\n\r\n");
  const first: IteratorResult<Buffer> = await accepted.socket.iterator().next();
  assert.equal(first.value.toString(), "GET / HTTP/1.1\r\n\r\n");
  client.destroy();
  accepted.socket.destroy();
});

test("a device that does not hold the federation key is refused by both sides", async () => {
  const network = networkOf(RELAY);
  const strangers = networkOf(RELAY);
  const desk = createIdentity();
  const outsider = createIdentity();

  // An outsider dialing a member: the member must not treat it as one.
  let [a, b] = streamPair();
  const dialing = await Promise.allSettled([
    secureDial(a, strangers, outsider, nodeIdOf(desk.certDer)),
    secureAccept(b, network, desk),
  ]);
  assert.equal(dialing[1].status, "rejected");
  assert.equal(dialing[0].status, "rejected");

  // A member dialing an impostor that answers with the right node id's place
  // but its own certificate: pinned by node id, so refused before any proof.
  [a, b] = streamPair();
  const impostor = await Promise.allSettled([
    secureDial(a, network, createIdentity(), nodeIdOf(desk.certDer)),
    secureAccept(b, strangers, outsider),
  ]);
  assert.equal(impostor[0].status, "rejected");
  assert.match(String((impostor[0] as PromiseRejectedResult).reason), /different node/);
});

test("a relay in the middle with its own certificates cannot join two members", async () => {
  const network = networkOf(RELAY);
  const desk = createIdentity();
  const phone = createIdentity();
  // The relay cannot derive the proof key: all it has is some other key.
  const relay = { identity: createIdentity(), network: networkOf(RELAY) };

  const [phoneSide, relayToPhone] = streamPair();
  const [relayToDesk, deskSide] = streamPair();
  const results = await Promise.allSettled([
    // The phone pins the desk's node id, so the relay must present... its own.
    secureDial(phoneSide, network, phone, nodeIdOf(desk.certDer)),
    secureAccept(relayToPhone, relay.network, relay.identity),
    // Towards the desk the relay can dial, but cannot produce the client proof.
    secureDial(relayToDesk, relay.network, relay.identity, nodeIdOf(desk.certDer)),
    secureAccept(deskSide, network, desk),
  ]);
  assert.equal(results[0].status, "rejected", "the phone accepted the relay as the desk");
  assert.equal(results[3].status, "rejected", "the desk accepted the relay as a member");
});
