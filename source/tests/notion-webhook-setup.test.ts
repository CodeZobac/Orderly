import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { authenticate, signIn, tokenHash } from "../lib/auth";
import {
  beginNotionSetup,
  captureNotionToken,
  discardNotionSetup,
  retrieveNotionToken,
  setupStatus,
} from "../lib/notion-webhook-setup";
import { postgresFixture } from "./postgres";

test("Notion verification capture is encrypted, operator-only, session-bound and single-assignment", async () => {
  const { pg, db } = await postgresFixture();
  const previousOwner = process.env.NOTION_WEBHOOK_SETUP_OWNER_ID,
    previousKey = process.env.ORDERLY_INTEGRATION_KEY;
  try {
    process.env.ORDERLY_INTEGRATION_KEY = randomBytes(32).toString("hex");
    const session = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      owner = await authenticate(db, session);
    const otherSession = await signIn(
        db,
        "register",
        `${randomUUID()}@test.local`,
        "long-fixture-password",
      ),
      other = await authenticate(db, otherSession);
    process.env.NOTION_WEBHOOK_SETUP_OWNER_ID = owner;
    const setup = await beginNotionSetup(
      db,
      owner,
      session,
      "https://fixture.example/settings",
    );
    const capability = new URL(setup.url).searchParams.get("setup")!;
    assert.equal(capability.length, 43);
    assert.equal((await setupStatus(db, owner, session)).received, false);
    assert.equal(
      (await setupStatus(db, other, otherSession)).authorized,
      false,
    );
    await assert.rejects(
      () =>
        beginNotionSetup(
          db,
          other,
          otherSession,
          "https://fixture.example/settings",
        ),
      /restricted/,
    );
    await assert.rejects(
      () => retrieveNotionToken(db, other, otherSession),
      /restricted/,
    );
    await assert.rejects(
      () => retrieveNotionToken(db, owner, session),
      /No Notion verification token/,
    );
    await assert.rejects(
      () =>
        captureNotionToken(
          db,
          "x".repeat(43),
          "secret_fixture_verification_token",
        ),
      /expired/,
    );
    await captureNotionToken(
      db,
      capability,
      "secret_fixture_verification_token",
    );
    await captureNotionToken(
      db,
      capability,
      "secret_fixture_replacement_token",
    );
    assert.equal((await setupStatus(db, owner, session)).received, true);
    assert.equal(
      (await retrieveNotionToken(db, owner, session)).token,
      "secret_fixture_verification_token",
    );
    const rows = await pg.query<{ hash: string; verifier: string }>(
      "select hash,verifier from orderly_private.oauth_states where provider='notion_webhook_setup'",
    );
    assert.equal(rows.rows[0].hash, tokenHash(capability));
    assert.notEqual(rows.rows[0].hash, capability);
    assert.equal(rows.rows[0].verifier.includes("secret_fixture"), false);
    assert.equal(rows.rows[0].verifier.startsWith("v1."), true);
    const newSession = await signIn(
      db,
      "login",
      (
        await pg.query<{ email: string }>(
          "select email from orderly_private.users where id=$1",
          [owner],
        )
      ).rows[0].email,
      "long-fixture-password",
    );
    await assert.rejects(
      () => retrieveNotionToken(db, owner, newSession),
      /No Notion verification token/,
    );
    assert.equal((await setupStatus(db, owner, newSession)).active, false);
    await discardNotionSetup(db, owner, session);
    await assert.rejects(
      () =>
        captureNotionToken(db, capability, "secret_fixture_verification_token"),
      /expired/,
    );
    const next = await beginNotionSetup(
      db,
      owner,
      session,
      "https://fixture.example/settings",
    );
    await pg.exec(
      "update orderly_private.oauth_states set expires=0 where provider='notion_webhook_setup'",
    );
    await assert.rejects(
      () =>
        captureNotionToken(
          db,
          new URL(next.url).searchParams.get("setup"),
          "secret_fixture_verification_token",
        ),
      /expired/,
    );
    await assert.rejects(
      () => retrieveNotionToken(db, owner, session),
      /No Notion verification token/,
    );
    const loggedOut = await beginNotionSetup(
      db,
      owner,
      session,
      "https://fixture.example/settings",
    );
    await db.rpc("orderly_auth", {
      command: "logout",
      input: { token: tokenHash(session) },
    });
    await assert.rejects(
      () =>
        captureNotionToken(
          db,
          new URL(loggedOut.url).searchParams.get("setup"),
          "secret_fixture_verification_token",
        ),
      /session expired/,
    );
    await assert.rejects(
      () => retrieveNotionToken(db, owner, session),
      /Sign in again/,
    );
    const grants = await pg.query<{ allowed: boolean }>(
      "select has_function_privilege('anon','public.orderly_notion_setup(text,text,jsonb)','execute') as allowed",
    );
    assert.equal(grants.rows[0].allowed, false);
  } finally {
    if (previousOwner === undefined)
      delete process.env.NOTION_WEBHOOK_SETUP_OWNER_ID;
    else process.env.NOTION_WEBHOOK_SETUP_OWNER_ID = previousOwner;
    if (previousKey === undefined) delete process.env.ORDERLY_INTEGRATION_KEY;
    else process.env.ORDERLY_INTEGRATION_KEY = previousKey;
    await pg.close();
  }
});
