import * as path from 'node:path';

type PathOperations = Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'>;

/** Both paths must already be canonicalized by realpath before this boundary check. */
export function isPathWithinPackage(packageRoot:string,entrypoint:string,paths:PathOperations=path):boolean {
 const relativePath=paths.relative(packageRoot,entrypoint);
 return relativePath!=='..'&&!relativePath.startsWith(`..${paths.sep}`)&&!paths.isAbsolute(relativePath);
}
