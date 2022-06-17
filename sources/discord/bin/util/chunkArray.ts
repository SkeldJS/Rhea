export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const out = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        out.push(array.slice(i, i + chunkSize));
    }
    return out;
}