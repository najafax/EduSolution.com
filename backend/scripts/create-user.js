require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// This script only ever creates/promotes into the two admin-tier roles —
// staff accounts need granular per-module permissions, which only make
// sense to set up through the in-app Users page, not this CLI. 'admin'
// stays the default so every existing invocation (with no --role) behaves
// exactly as before.
const ROLES = ['admin', 'super_admin'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Reads without echoing. Needs a TTY for raw mode; when stdin is piped or
// otherwise not a terminal we fall back to a normal (visible) prompt rather
// than crashing, so this still works over `render ssh` and in scripts.
function askHidden(prompt) {
  if (!process.stdin.isTTY) return ask(`${prompt}(warning: input will be visible) `);

  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.setRawMode(true);

    let value = '';
    const onData = (chunk) => {
      const char = chunk.toString('utf8');
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.exit(130);
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
      } else if (char >= ' ') {
        value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const users = db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY id').all();
    if (users.length === 0) {
      console.log('No user accounts exist yet. Run this script without --list to create one.');
    } else {
      console.log(`${users.length} user account(s):`);
      users.forEach((u) =>
        console.log(`  #${u.id}  ${u.name} <${u.email}>  ${u.role}${u.active ? '' : ' (deactivated)'}  (created ${u.created_at})`),
      );
    }
    return;
  }

  let role = 'admin';
  if (args.role) {
    role = String(args.role).trim().toLowerCase();
    if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
  }

  // Email is resolved before name — a pure role change (below) only needs
  // an email to find the target account, and shouldn't have to prompt for
  // a name it will never use.
  const emailInput = args.email || (await ask('Email: '));
  const email = String(emailInput).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error(`"${email}" is not a valid email address`);

  const existing = db.prepare('SELECT id, name, role FROM users WHERE email = ?').get(email);

  // A role change for an existing account is handled as its own, separate
  // action — it never touches the password (or the name), and exits before
  // the password-reset prompt below even gets a chance to ask anything.
  // This is the bootstrap path for the very first super_admin: nobody else
  // can promote anyone into that tier from inside the app yet (see
  // routes/users.js's assertSuperAdminForAdminTier), so it has to be
  // possible from here, with only shell access as the trust bar.
  if (existing && args.role && role !== existing.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, existing.id);
    console.log(`\nRole changed for ${existing.name} <${email}> (user #${existing.id}): ${existing.role} -> ${role}.`);
    return;
  }

  const name = args.name || (await ask('Full name: '));
  if (!name) throw new Error('Name is required');

  if (existing && !args.password) {
    const answer = await ask(`An account already exists for ${email} (${existing.name}). Reset its password? [y/N] `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted. No changes made.');
      return;
    }
  }

  // --password is handy for automation, but it lands in shell history, so
  // the interactive prompt stays the default and confirms the entry.
  let password = args.password || process.env.CREATE_USER_PASSWORD;
  if (!password) {
    password = await askHidden('Password: ');
    const confirm = await askHidden('Confirm password: ');
    if (password !== confirm) throw new Error('Passwords do not match');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    db.prepare(
      `UPDATE users SET name = ?, password_hash = ?, active = 1, reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
    ).run(name.trim(), passwordHash, existing.id);
    console.log(`\nPassword reset for ${name.trim()} <${email}> (user #${existing.id}).`);
  } else {
    // Shell access to run this script is already a higher trust level than
    // anything the in-app permission system could restrict, so CLI-created
    // accounts are always admin-tier (admin by default, or super_admin via
    // --role) — this is the bootstrap/recovery path. Day-to-day staff
    // accounts with granular permissions are created by an admin from the
    // app's Users page instead.
    const result = db
      .prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`)
      .run(name.trim(), email, passwordHash, role);
    console.log(`\nCreated ${role} user ${name.trim()} <${email}> (user #${result.lastInsertRowid}).`);
  }

  console.log('They can now sign in at the app\'s /login page.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
