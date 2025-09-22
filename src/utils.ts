import { readFileSync } from 'fs';
import moment from 'moment';
import chalk from 'chalk';
// @ts-ignore - node:sea is experimental and may not have types
import { isSea, getAsset } from 'node:sea';

export function time(): string {
    return moment().format('YYYY/MM/DD HH:mm:ss');
}

export async function sleep(n: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, n);
    });
}

interface Logger {
    info(...msg: any[]): void;
    error(...msg: any[]): void;
    warn(...msg: any[]): void;
    success(...msg: any[]): void;
    direct(...msg: any[]): void;
    title(...msg: any[]): void;
    line(): void;
}

export const log: Logger = {
    info(...msg: any[]): void {
        console.log(chalk.cyan(time()), chalk.bold('[Info]'), ...msg);
    },
    error(...msg: any[]): void {
        console.error(chalk.cyan(time()), chalk.red.bold('[Error]'), ...msg);
    },
    warn(...msg: any[]): void {
        console.log(chalk.cyan(time()), chalk.yellow.bold('[Warn]'), ...msg);
    },
    success(...msg: any[]): void {
        console.log(chalk.cyan(time()), chalk.green.bold('[Success]'), ...msg);
    },
    direct(...msg: any[]): void {
        console.log(chalk.magenta(...msg));
    },
    title(...msg: any[]): void {
        console.log(chalk.cyan.bold(...msg));
    },
    line(): void {
        console.log();
    },
};

export function asset(name: string): string | Buffer {
    if (isSea()) {
        return getAsset(name, 'UTF-8');
    } else {
        return readFileSync(name);
    }
}