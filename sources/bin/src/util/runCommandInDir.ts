import child_process from "child_process";

export function runCommandInDir(cwd: string, command: string) {
    return new Promise<string>((resolve, reject) => {
        child_process.exec(command, {
            cwd
        }, (err, stdout, stderr) => {
            if (err)
                return reject(err);

            resolve(stdout);
        })
    });
}