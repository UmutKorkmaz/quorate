import type { CheckOutcome } from '../release/types.js';
import type { BoundedCommandOptions,BoundedCommandResult } from '../bounded-command.js';
export interface CommandMetadata {command:string;flags:string[]}
export interface DocsStep {id:string;argv:string[];expectedExit:number;stdoutIncludes?:string[];expectedJson?:unknown;timeoutMs?:number}
export interface DocsManifest {
 schemaVersion:1;sourceRevision:string;
 artifact:{mode:'source-candidate';entrypoint:string}|{mode:'published-package';package:string;version:string;entrypoint:string};
 files?:{path:string;content:string}[];steps:DocsStep[];
 documentation?:{path:string;sha256:string};advertisedOptions?:CommandMetadata[];deadlineMs?:number;maxOutputBytes?:number;
}
export interface DocsCheck {id:string;outcome:CheckOutcome;expectedExit:number;actualExit:number|null;stdout:{text:string;truncated:boolean};stderr:{text:string;truncated:boolean};durationMs:number}
export interface DocsCheckReport {
 schemaVersion:1;kind:'docs-check';sourceRevision:string;manifestDigest:string;subjectDigest:string;
 producer:{id:'quorate-local';trust:'unattested'};createdAt:string;artifactMode:DocsManifest['artifact']['mode'];
 decision:{state:'verified'|'failed'|'inconclusive';reason:string};functionalState:'verified'|'failed'|'inconclusive';checks:DocsCheck[];
 freshness:{state:'current'|'stale'|'unknown';issues:string[]};issues:string[];
}
export interface DocsAdapter {run(options:BoundedCommandOptions):Promise<BoundedCommandResult>}
