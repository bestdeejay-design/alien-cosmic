// Compatibility entrypoint: the owner replaced auto-login by an explicit entry screen.
import {execFileSync} from 'node:child_process';
const modes={cloud:'cloud',offline:'offline',later:'skip',esc:'skip',midgame:'load-cloud'};
const out=execFileSync(process.execPath,[new URL('./sim_auth_entry4.mjs',import.meta.url).pathname,modes[process.argv[2]]||'cloud'],{encoding:'utf8'});
console.log(out.split('\n').filter(l=>l.startsWith('PASS')).join('\n'));
