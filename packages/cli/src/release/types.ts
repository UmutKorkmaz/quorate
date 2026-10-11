export type CheckOutcome='passed'|'failed'|'inconclusive'|'missing';
export type ReleaseState='planned'|'submitted'|'available'|'verified'|'failed'|'unknown';
export interface ReleaseCheck {id:string;outcome:CheckOutcome}
interface TargetBase {id:string;submission?:'accepted'|'rejected'|'unknown';expectedSourceRevision?:string;expectedProvenanceDigest?:string}
export interface NpmTarget extends TargetBase {kind:'npm';package:string;version:string;expectedIntegrity:string}
export interface GitHubTarget extends TargetBase {kind:'github';repository:string;tag:string;assetId:number;name:string;expectedSha256:string}
export type ReleaseTarget=NpmTarget|GitHubTarget;
export interface ReleaseManifest {schemaVersion:1;sourceRevision:string;deadlineMs?:number;destinations:ReleaseTarget[]}
export interface ReleaseObservation {at:string;state:ReleaseState;code:string;digest?:string;version?:string;assetId?:number;name?:string;sourceRevision?:string;provenanceDigest?:string}
export interface ReleaseDestination {id:string;identity:string;expectedDigest:string;state:ReleaseState;observations:ReleaseObservation[];checks:ReleaseCheck[]}
export interface ReleaseReport {
 schemaVersion:1;kind:'release-verification';sourceRevision:string;manifestDigest:string;subjectDigest:string;
 producer:{id:'quorate-local';trust:'unattested'};createdAt:string;deadlineAt:string;
 decision:{state:'verified'|'failed'|'inconclusive';reason:string};destinations:ReleaseDestination[];issues:string[];
}
export interface ArtifactObservation {
 status:'available'|'missing'|'unknown'|'failed';version?:string;assetId?:number;name?:string;digest?:string;
 sourceRevision?:string;provenanceDigest?:string;code?:string;
}
export interface SmokeObservation {status:'verified'|'missing'|'unknown'|'failed';code?:string}
export interface ReleaseAdapters {
 now():number;sleep(ms:number):Promise<void>;
 observe(target:ReleaseTarget,budgetMs:number):Promise<ArtifactObservation>;
 smoke(target:NpmTarget,budgetMs:number):Promise<SmokeObservation>;
}
