import * as yaml from "js-yaml";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { asset, log } from "./utils.js";

export interface TrainConfig {
    code: string;
    from?: string;
    to?: string;
    seatCategory?: string[];
    checkRoundTrip?: boolean;
}

export interface SearchConfig {
    date: string[];
    from: string;
    to: string;
    trains_filter?: {
        from: string[];
        to: string[];
        beginHour: number;
        endHour: number;
        fromTeleCode?: string[];
        toTeleCode?: string[];
    };
    remark?: string;
    seatCategory?: string[];
    trains?: TrainConfig[];
    exclude?: {
        trains?: string[];
        to?: string[];
    };
    // CLI 生成的配置中可能包含 queryParams
    queryParams?: {
        purpose_codes?: string;
        ADULT?: number;
        CHILD?: number;
        STUDENT?: number;
    };
}

export interface NotificationConfig {
    type: string;
    [key: string]: any;
}

export interface Config {
    watch: SearchConfig[];
    notifications: NotificationConfig[];
    interval?: number;
    delay?: number;
}

export class ConfigManager {
    private static instance: ConfigManager;
    private config: Config | null = null;
    private configPath: string = "config.yml";

    private constructor() { }

    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    load(path: string = "config.yml"): Config {
        this.configPath = path;
        try {
            const configContent = readFileSync(path, "utf-8");
            this.config = yaml.load(configContent) as Config;
            this.validate();
            return this.config;
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.createDefault();
                log.error("配置文件不存在，已自动创建 config.yml，请修改后重启");
                process.exit(0);
            }
            throw new Error(`配置文件加载失败: ${err.message}`);
        }
    }

    get(): Config {
        if (!this.config) {
            throw new Error("配置未加载");
        }
        return this.config;
    }

    private createDefault() {
        try {
            writeFileSync(this.configPath, asset("config.example.yml"));
        } catch (e) {
            // 如果没有 example 文件，写入一个空的结构
            const defaultConfig: Config = {
                watch: [],
                notifications: [],
                interval: 15,
                delay: 5
            };
            writeFileSync(this.configPath, yaml.dump(defaultConfig));
        }
    }

    private validate() {
        if (!this.config) return;
        if (!this.config.watch || !Array.isArray(this.config.watch)) {
            throw new Error("配置格式错误: watch 字段必须是数组");
        }
        // 设置默认值
        if (!this.config.interval) this.config.interval = 15;
        if (!this.config.delay) this.config.delay = 5;
    }
}
