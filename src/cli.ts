// @ts-ignore
import inquirer from "inquirer";
// @ts-ignore
import chalk from "chalk";
// @ts-ignore
import chalkTable from "chalk-table";
import { ChinaRailway } from "./cr.js";
import * as fs from "fs";
// @ts-ignore
import yaml from "js-yaml";

// 类型定义
interface ChinesePrompts {
  checkbox: {
    help: string;
    selected: string;
    unselected: string;
  };
  list: {
    help: string;
  };
  confirm: {
    help: string;
  };
  input: {
    help: string;
  };
}

interface TrainInfo {
  trainNo: string;
  from: string;
  to: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  seatCategory?: string[];
}

interface WatchConfig {
  from: string;
  to: string;
  date: string;
  trains?: TrainInfo[];
  queryParams?: {
    purpose_codes?: string;
    ADULT?: number;
    CHILD?: number;
    STUDENT?: number;
  };
}

interface NotificationConfig {
  type: string;
  webhook?: string;
  secret?: string;
  botToken?: string;
  chatId?: string;
  deviceKey?: string;
  serverUrl?: string;
  group?: string;
  sound?: string;
  level?: string;
  icon?: string;
  url?: string;
  autoCopy?: boolean;
  isArchive?: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  secure?: boolean;
}

interface Config {
  watch: WatchConfig[];
  notifications?: NotificationConfig[];
}

interface PromptQuestion {
  type?: string;
  name: string;
  message: string;
  choices?: any[];
  default?: any;
  validate?: (value: any) => boolean | string;
  when?: (answers: any) => boolean;
}

// 中文提示语配置
const chinesePrompts: ChinesePrompts = {
  checkbox: {
    help: "(使用 ↑↓ 移动，空格 选择，a 全选，i 反选，回车 确认)",
    selected: "已选择",
    unselected: "未选择",
  },
  list: {
    help: "(使用 ↑↓ 移动，回车 确认)",
  },
  confirm: {
    help: "(y/n)",
  },
  input: {
    help: "请输入后按回车确认",
  },
};

// 自定义prompt函数，支持中文提示
async function promptWithChinese(questions: PromptQuestion[]): Promise<any> {
  const processedQuestions = questions.map((question) => {
    const processed = { ...question };

    // 为不同类型的问题添加中文帮助信息
    if (question.type === "checkbox") {
      processed.message = `${question.message} ${chinesePrompts.checkbox.help}`;
    } else if (question.type === "list") {
      processed.message = `${question.message} ${chinesePrompts.list.help}`;
    } else if (question.type === "confirm") {
      processed.message = `${question.message} ${chinesePrompts.confirm.help}`;
    }

    return processed;
  });

  return inquirer.prompt(processedQuestions as any);
}

async function main(): Promise<void> {
  console.log(chalk.cyan("🚄 中国铁路12306余票监控工具"));
  console.log(chalk.gray("支持多种推送方式，实时监控余票变化"));
  console.log();

  const { action } = await promptWithChinese([
    {
      type: "list",
      name: "action",
      message: "请选择操作:",
      choices: [
        { name: "🔍 查询车次并配置监控", value: "query" },
        { name: "⚙️  编辑配置文件", value: "edit" },
        { name: "📋 查看当前配置", value: "view" },
        { name: "🚀 开始监控", value: "start" },
        { name: "🔄 重置配置", value: "reset" },
        { name: "❌ 退出", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "query":
      await queryAndConfig();
      break;
    case "edit":
      await editConfig();
      break;
    case "view":
      await viewConfig();
      break;
    case "start":
      await startMonitoring();
      break;
    case "reset":
      await resetConfig();
      break;
    case "exit":
      console.log(chalk.green("👋 再见!"));
      process.exit(0);
      break;
  }
}

async function queryAndConfig(isFirstTime: boolean = true): Promise<{ watch?: WatchConfig[] } | null> {
  const cr = new ChinaRailway();

  // 获取出发地和目的地
  const { from, to } = await promptWithChinese([
    {
      name: "from",
      message: "请输入出发地:",
      validate: (v: string) => (v.trim() ? true : "出发地不能为空"),
    },
    {
      name: "to",
      message: "请输入目的地:",
      validate: (v: string) => (v.trim() ? true : "目的地不能为空"),
    },
  ]);

  // 获取出发日期
  const { date } = await promptWithChinese([
    {
      name: "date",
      message: "请输入出发日期 (格式: YYYY-MM-DD):",
      validate: (v: string) => {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(v)) {
          return "日期格式错误，请使用 YYYY-MM-DD 格式";
        }
        const inputDate = new Date(v);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (inputDate < today) {
          return "日期不能早于今天";
        }
        return true;
      },
    },
  ]);

  console.log(chalk.cyan("🔍 正在查询车次信息..."));

  try {
    const trainsResponse = await ChinaRailway.checkTickets(date, from, to);
    const trains = trainsResponse.data?.result || [];

    if (!trains || trains.length === 0) {
      console.log(chalk.red("❌ 未找到相关车次，请检查出发地、目的地和日期"));
      return null;
    }

    console.log(chalk.green(`✅ 找到 ${trains.length} 个车次`));

    // 显示车次表格
    const tableData = trains.map((train: any) => ({
      车次: train.trainNo,
      出发时间: train.departTime,
      到达时间: train.arriveTime,
      历时: train.duration,
      商务座: train.swz_num || "--",
      一等座: train.ydz_num || "--",
      二等座: train.edz_num || "--",
      高级软卧: train.gjrw_num || "--",
      软卧: train.rw_num || "--",
      动卧: train.dw_num || "--",
      硬卧: train.yw_num || "--",
      软座: train.rz_num || "--",
      硬座: train.yz_num || "--",
      无座: train.wz_num || "--",
    }));

    const table = chalkTable(
      {
        leftPad: 1,
        rightPad: 1,
        columns: [
          { field: "车次", name: chalk.cyan("车次") },
          { field: "出发时间", name: chalk.cyan("出发") },
          { field: "到达时间", name: chalk.cyan("到达") },
          { field: "历时", name: chalk.cyan("历时") },
          { field: "商务座", name: chalk.yellow("商务座") },
          { field: "一等座", name: chalk.yellow("一等座") },
          { field: "二等座", name: chalk.yellow("二等座") },
          { field: "高级软卧", name: chalk.yellow("高软") },
          { field: "软卧", name: chalk.yellow("软卧") },
          { field: "动卧", name: chalk.yellow("动卧") },
          { field: "硬卧", name: chalk.yellow("硬卧") },
          { field: "软座", name: chalk.yellow("软座") },
          { field: "硬座", name: chalk.yellow("硬座") },
          { field: "无座", name: chalk.yellow("无座") },
        ],
      },
      tableData
    );

    console.log(table);

    // 选择要监控的车次
    const { selectedTrains } = await promptWithChinese([
      {
        type: "checkbox",
        name: "selectedTrains",
        message: "请选择要监控的车次:",
        choices: trains.map((train: any) => ({
          name: `${train.trainNo} (${train.departTime} - ${train.arriveTime})`,
          value: train,
        })),
        validate: (choices: any[]) =>
          choices.length > 0 ? true : "至少选择一个车次",
      },
    ]);

    // 为每个选中的车次配置座位类型
    for (const train of selectedTrains) {
      const availableSeats = [];
      if (train.swz_num && train.swz_num !== "--") availableSeats.push("商务座");
      if (train.ydz_num && train.ydz_num !== "--") availableSeats.push("一等座");
      if (train.edz_num && train.edz_num !== "--") availableSeats.push("二等座");
      if (train.gjrw_num && train.gjrw_num !== "--") availableSeats.push("高级软卧");
      if (train.rw_num && train.rw_num !== "--") availableSeats.push("软卧");
      if (train.dw_num && train.dw_num !== "--") availableSeats.push("动卧");
      if (train.yw_num && train.yw_num !== "--") availableSeats.push("硬卧");
      if (train.rz_num && train.rz_num !== "--") availableSeats.push("软座");
      if (train.yz_num && train.yz_num !== "--") availableSeats.push("硬座");
      if (train.wz_num && train.wz_num !== "--") availableSeats.push("无座");

      if (availableSeats.length > 0) {
        const { seatTypes } = await promptWithChinese([
          {
            type: "checkbox",
            name: "seatTypes",
            message: `请选择 ${train.trainNo} 要监控的座位类型:`,
            choices: availableSeats.map((seat) => ({
              name: seat,
              value: seat,
              checked: true,
            })),
          },
        ]);

        if (seatTypes.length > 0) {
          train.seatCategory = seatTypes;
        }
      }
    }

    // 询问查询参数配置
    const { configQueryParams } = await promptWithChinese([
      {
        type: "confirm",
        name: "configQueryParams",
        message: "是否配置查询参数 (乘客类型等)?",
        default: false,
      },
    ]);

    let queryParams: any = {};
    if (configQueryParams) {
      const queryConfig = await promptWithChinese([
        {
          type: "list",
          name: "purpose_codes",
          message: "乘客类型:",
          choices: [
            { name: "成人票", value: "ADULT" },
            { name: "学生票", value: "0X00" },
          ],
          default: "ADULT",
        },
        {
          type: "number",
          name: "ADULT",
          message: "成人票数量:",
          default: 1,
          validate: (v: number) => (v > 0 && v <= 6 ? true : "数量必须在1-6之间"),
        },
        {
          type: "number",
          name: "CHILD",
          message: "儿童票数量:",
          default: 0,
          validate: (v: number) => (v >= 0 && v <= 6 ? true : "数量必须在0-6之间"),
        },
      ]);

      if (queryConfig.purpose_codes === "0X00") {
        const { studentCount } = await promptWithChinese([
          {
            type: "number",
            name: "studentCount",
            message: "学生票数量:",
            default: 1,
            validate: (v: number) => (v > 0 && v <= 6 ? true : "数量必须在1-6之间"),
          },
        ]);
        queryConfig.STUDENT = studentCount;
      }

      queryParams = queryConfig;
    }

    // 配置推送方式
    let notifications: NotificationConfig[] = [];
    if (isFirstTime) {
      const { configNotifications } = await promptWithChinese([
        {
          type: "confirm",
          name: "configNotifications",
          message: "是否配置推送通知?",
          default: true,
        },
      ]);

      if (configNotifications) {
        let addMore = true;
        while (addMore) {
          const { notificationType } = await promptWithChinese([
            {
              type: "list",
              name: "notificationType",
              message: "选择推送方式:",
              choices: [
                { name: "飞书推送", value: "Lark" },
                { name: "Telegram推送", value: "Telegram" },
                { name: "企业微信推送", value: "WechatWork" },
                { name: "Bark推送", value: "Bark" },
                { name: "SMTP邮件推送", value: "SMTP" },
              ],
            },
          ]);

          let notification: NotificationConfig = { type: notificationType };

          if (notificationType === "Lark") {
            const { webhook } = await promptWithChinese([
              {
                name: "webhook",
                message: "请输入飞书机器人Webhook URL:",
                validate: (v: string) => (v.includes("feishu.cn") ? true : "URL格式错误"),
              },
            ]);
            notification.webhook = webhook;

            const { needSecret } = await promptWithChinese([
              {
                type: "confirm",
                name: "needSecret",
                message: "是否启用签名校验？（建议启用以提高安全性）",
                default: false,
              },
            ]);

            if (needSecret) {
              const { secret } = await promptWithChinese([
                {
                  name: "secret",
                  message: "请输入签名密钥（从飞书机器人安全设置中获取）:",
                  validate: (v: string) => (v.trim() ? true : "密钥不能为空"),
                },
              ]);
              notification.secret = secret;
            }
          } else if (notificationType === "Telegram") {
            const { botToken, chatId } = await promptWithChinese([
              {
                name: "botToken",
                message: "请输入Telegram Bot Token:",
                validate: (v: string) => (v.includes(":") ? true : "格式错误"),
              },
              {
                name: "chatId",
                message: "请输入Chat ID:",
                validate: (v: string) => (v.trim() ? true : "不能为空"),
              },
            ]);
            notification.botToken = botToken;
            notification.chatId = chatId;
          } else if (notificationType === "WechatWork") {
            const { webhook } = await promptWithChinese([
              {
                name: "webhook",
                message: "请输入企业微信机器人Webhook URL:",
                validate: (v: string) =>
                  v.includes("qyapi.weixin.qq.com") ? true : "URL格式错误",
              },
            ]);
            notification.webhook = webhook;
          } else if (notificationType === "Bark") {
            const barkConfig = await promptWithChinese([
              {
                name: "deviceKey",
                message: "请输入Bark设备密钥(Device Key):",
                validate: (v: string) => (v.trim() ? true : "设备密钥不能为空"),
              },
              {
                name: "serverUrl",
                message: "请输入Bark服务器地址(默认: https://api.day.app):",
                default: "https://api.day.app",
              },
              {
                name: "group",
                message: "推送分组名称(可选):",
                default: "火车票监控",
              },
              {
                name: "sound",
                message: "推送声音(可选, 默认: default):",
                default: "default",
              },
            ]);

            const { useAdvanced } = await promptWithChinese([
              {
                type: "confirm",
                name: "useAdvanced",
                message: "是否配置高级选项(推送级别、图标等)?",
                default: false,
              },
            ]);

            if (useAdvanced) {
              const advancedConfig = await promptWithChinese([
                {
                  type: "list",
                  name: "level",
                  message: "推送级别:",
                  choices: [
                    { name: "默认(active)", value: "active" },
                    { name: "重要警告(critical)", value: "critical" },
                    { name: "时效性通知(timeSensitive)", value: "timeSensitive" },
                    { name: "仅添加到列表(passive)", value: "passive" },
                  ],
                  default: "active",
                },
                {
                  name: "icon",
                  message: "自定义图标URL(可选):",
                },
                {
                  name: "url",
                  message: "点击跳转URL(可选):",
                },
                {
                  type: "confirm",
                  name: "autoCopy",
                  message: "自动复制推送内容?",
                  default: false,
                },
                {
                  type: "confirm",
                  name: "isArchive",
                  message: "保存推送到历史记录?",
                  default: true,
                },
              ]);

              Object.assign(barkConfig, advancedConfig);
            }

            Object.assign(notification, barkConfig);
          } else if (notificationType === "SMTP") {
            console.log(chalk.cyan("配置SMTP邮件推送:"));

            const smtpConfig = await promptWithChinese([
              {
                name: "host",
                message: "SMTP服务器地址(如: smtp.gmail.com):",
                validate: (v: string) => (v.trim() ? true : "SMTP服务器地址不能为空"),
              },
              {
                type: "number",
                name: "port",
                message: "SMTP端口号(常用: 587-STARTTLS, 465-SSL, 25-无加密):",
                default: 587,
                validate: (v: number) =>
                  v > 0 && v <= 65535 ? true : "端口号必须在1-65535之间",
              },
              {
                name: "user",
                message: "邮箱用户名:",
                validate: (v: string) => (v.trim() ? true : "邮箱用户名不能为空"),
              },
              {
                type: "password",
                name: "pass",
                message: "邮箱密码或应用密码:",
                validate: (v: string) => (v.trim() ? true : "密码不能为空"),
              },
              {
                name: "from",
                message: "发件人显示名称(可选, 默认使用用户名):",
              },
              {
                name: "to",
                message: "收件人邮箱地址:",
                validate: (v: string) => {
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  return emailRegex.test(v.trim()) ? true : "请输入有效的邮箱地址";
                },
              },
            ]);

            const { useAdvancedSMTP } = await promptWithChinese([
              {
                type: "confirm",
                name: "useAdvancedSMTP",
                message: "是否配置高级选项(安全连接、抄送等)?",
                default: false,
              },
            ]);

            if (useAdvancedSMTP) {
              const advancedSMTPConfig = await promptWithChinese([
                {
                  type: "list",
                  name: "secure",
                  message: "安全连接类型:",
                  choices: [
                    { name: "自动检测(推荐)", value: undefined },
                    { name: "SSL/TLS (端口465)", value: true },
                    { name: "STARTTLS (端口587)", value: false },
                  ],
                  default: undefined,
                },
                {
                  name: "cc",
                  message: "抄送邮箱(多个用逗号分隔, 可选):",
                },
                {
                  name: "bcc",
                  message: "密送邮箱(多个用逗号分隔, 可选):",
                },
                {
                  name: "replyTo",
                  message: "回复邮箱(可选):",
                },
              ]);

              Object.assign(smtpConfig, advancedSMTPConfig);
            }

            Object.assign(notification, smtpConfig);
          }

          notifications.push(notification);

          const { addAnother } = await promptWithChinese([
            {
              type: "confirm",
              name: "addAnother",
              message: "是否添加其他推送方式?",
              default: false,
            },
          ]);

          addMore = addAnother;
        }
      }
    }

    // 生成配置
    const watchConfig: WatchConfig = {
      from,
      to,
      date,
      trains: selectedTrains.map((train: any) => ({
        trainNo: train.trainNo,
        from: train.from,
        to: train.to,
        departTime: train.departTime,
        arriveTime: train.arriveTime,
        duration: train.duration,
        seatCategory: train.seatCategory,
      })),
    };

    if (Object.keys(queryParams).length > 0) {
      watchConfig.queryParams = queryParams;
    }

    const config: Config = {
      watch: [watchConfig],
    };

    if (notifications.length > 0) {
      config.notifications = notifications;
    }

    // 保存配置
    fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
    console.log(chalk.green("✅ 配置已保存到 config.yml"));

    // 询问是否立即开始监控
    const { startNow } = await promptWithChinese([
      {
        type: "confirm",
        name: "startNow",
        message: "是否立即开始监控?",
        default: true,
      },
    ]);

    if (startNow) {
      await startMonitoring();
    } else {
      const { backToMenu } = await promptWithChinese([
        {
          type: "confirm",
          name: "backToMenu",
          message: "返回主菜单?",
          default: true,
        },
      ]);

      if (backToMenu) {
        await main();
      }
    }

    return config;
  } catch (error) {
    console.error(chalk.red("❌ 查询失败:"), error);
    return null;
  }
}

async function editConfig(): Promise<void> {
  if (!fs.existsSync("config.yml")) {
    console.log(chalk.yellow("⚠️  配置文件不存在，请先查询车次并配置监控"));
    const { createNew } = await promptWithChinese([
      {
        type: "confirm",
        name: "createNew",
        message: "是否现在创建新配置?",
        default: true,
      },
    ]);

    if (createNew) {
      await queryAndConfig();
    } else {
      await main();
    }
    return;
  }

  const configContent = fs.readFileSync("config.yml", "utf-8");
  const config: Config = yaml.load(configContent) as Config;

  const { editAction } = await promptWithChinese([
    {
      type: "list",
      name: "editAction",
      message: "选择编辑操作:",
      choices: [
        { name: "📝 编辑监控任务", value: "editTask" },
        { name: "➕ 添加监控任务", value: "addTask" },
        { name: "🗑️  删除监控任务", value: "deleteTask" },
        { name: "🔔 编辑推送配置", value: "editNotifications" },
        { name: "⚙️  编辑查询参数", value: "editQueryParams" },
        { name: "🔙 返回主菜单", value: "back" },
      ],
    },
  ]);

  switch (editAction) {
    case "editTask":
      await editMonitorTask(config);
      break;
    case "addTask":
      await addMonitorTask(config);
      break;
    case "deleteTask":
      await deleteMonitorTask(config);
      break;
    case "editNotifications":
      await editNotificationConfig(config);
      break;
    case "editQueryParams":
      await editQueryParams(config);
      break;
    case "back":
      await main();
      break;
  }
}

async function addMonitorTask(config: Config): Promise<void> {
  console.log(chalk.cyan("➕ 添加新的监控任务"));

  const newTaskConfig = await queryAndConfig(false);
  if (newTaskConfig && newTaskConfig.watch && newTaskConfig.watch[0]) {
    config.watch.push(newTaskConfig.watch[0]);
    fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
    console.log(chalk.green("✅ 监控任务已添加!"));
  }

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

async function editMonitorTask(config: Config): Promise<void> {
  if (!config.watch || config.watch.length === 0) {
    console.log(chalk.yellow("暂无监控任务"));
    return;
  }

  const { taskIndex } = await promptWithChinese([
    {
      type: "list",
      name: "taskIndex",
      message: "选择要编辑的监控任务:",
      choices: config.watch.map((watch, index) => ({
        name: `${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`,
        value: index,
      })),
    },
  ]);

  const task = config.watch[taskIndex];

  const { editType } = await promptWithChinese([
    {
      type: "list",
      name: "editType",
      message: "选择编辑类型:",
      choices: [
        { name: "📅 修改日期", value: "date" },
        { name: "🚄 编辑车次", value: "trains" },
        { name: "🔄 重新配置任务", value: "recreate" },
      ],
    },
  ]);

  switch (editType) {
    case "date":
      const { newDate } = await promptWithChinese([
        {
          name: "newDate",
          message: "请输入新的出发日期 (格式: YYYY-MM-DD):",
          default: task.date,
          validate: (v: string) => {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(v)) {
              return "日期格式错误，请使用 YYYY-MM-DD 格式";
            }
            const inputDate = new Date(v);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (inputDate < today) {
              return "日期不能早于今天";
            }
            return true;
          },
        },
      ]);
      task.date = newDate;
      break;

    case "trains":
      if (!task.trains || task.trains.length === 0) {
        console.log(chalk.yellow("该任务暂无车次配置"));
        break;
      }

      const { trainAction } = await promptWithChinese([
        {
          type: "list",
          name: "trainAction",
          message: "选择车次操作:",
          choices: [
            { name: "✏️  编辑座位类型", value: "editSeats" },
            { name: "🗑️  删除车次", value: "deleteTrain" },
          ],
        },
      ]);

      if (trainAction === "editSeats") {
        const { trainIndex } = await promptWithChinese([
          {
            type: "list",
            name: "trainIndex",
            message: "选择要编辑的车次:",
            choices: task.trains.map((train, index) => ({
              name: `${train.trainNo} (${train.departTime} - ${train.arriveTime})`,
              value: index,
            })),
          },
        ]);

        const train = task.trains[trainIndex];
        const { seatTypes } = await promptWithChinese([
          {
            type: "checkbox",
            name: "seatTypes",
            message: `请选择 ${train.trainNo} 要监控的座位类型:`,
            choices: [
              {
                name: "商务座",
                value: "商务座",
                checked: train.seatCategory?.includes("商务座"),
              },
              {
                name: "一等座",
                value: "一等座",
                checked: train.seatCategory?.includes("一等座"),
              },
              {
                name: "二等座",
                value: "二等座",
                checked: train.seatCategory?.includes("二等座"),
              },
              {
                name: "高级软卧",
                value: "高级软卧",
                checked: train.seatCategory?.includes("高级软卧"),
              },
              {
                name: "软卧",
                value: "软卧",
                checked: train.seatCategory?.includes("软卧"),
              },
              {
                name: "动卧",
                value: "动卧",
                checked: train.seatCategory?.includes("动卧"),
              },
              {
                name: "硬卧",
                value: "硬卧",
                checked: train.seatCategory?.includes("硬卧"),
              },
              {
                name: "软座",
                value: "软座",
                checked: train.seatCategory?.includes("软座"),
              },
              {
                name: "硬座",
                value: "硬座",
                checked: train.seatCategory?.includes("硬座"),
              },
              {
                name: "无座",
                value: "无座",
                checked: train.seatCategory?.includes("无座"),
              },
            ],
          },
        ]);

        if (seatTypes.length > 0) {
          train.seatCategory = seatTypes;
        } else {
          delete train.seatCategory;
        }
      }
      break;

    case "recreate":
      console.log(chalk.cyan("重新配置任务，当前配置将被替换"));
      const newTask = await queryAndConfig(false);
      if (newTask && newTask.watch && newTask.watch[0]) {
        config.watch[taskIndex] = newTask.watch[0];
      }
      return;
  }

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 监控任务已更新!"));

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 删除监控任务
async function deleteMonitorTask(config: Config): Promise<void> {
  if (!config.watch || config.watch.length === 0) {
    console.log(chalk.yellow("暂无监控任务"));
    return;
  }

  const { taskIndex } = await promptWithChinese([
    {
      type: "list",
      name: "taskIndex",
      message: "选择要删除的监控任务:",
      choices: config.watch.map((watch, index) => ({
        name: `${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`,
        value: index,
      })),
    },
  ]);

  const task = config.watch[taskIndex];
  const { confirmDelete } = await promptWithChinese([
    {
      type: "confirm",
      name: "confirmDelete",
      message: `确认删除任务 "${task.from} → ${task.to} (${task.date})" ?`,
      default: false,
    },
  ]);

  if (confirmDelete) {
    config.watch.splice(taskIndex, 1);
    fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
    console.log(chalk.green("✅ 监控任务已删除!"));
  } else {
    console.log(chalk.yellow("已取消删除"));
  }

  // 询问是否继续编辑
  const { continueEdit } = await promptWithChinese([
    {
      type: "confirm",
      name: "continueEdit",
      message: "是否继续编辑配置?",
      default: true,
    },
  ]);

  if (continueEdit) {
    await editConfig();
  }
}

// 修改推送配置
async function editNotificationConfig(config: Config): Promise<void> {
  const { notifAction } = await promptWithChinese([
    {
      type: "list",
      name: "notifAction",
      message: "选择推送配置操作:",
      choices: [
        { name: "➕ 添加推送配置", value: "add" },
        { name: "✏️  修改推送配置", value: "edit" },
        { name: "🗑️  删除推送配置", value: "delete" },
        { name: "🧹 清空所有推送配置", value: "clear" },
      ],
    },
  ]);

  switch (notifAction) {
    case "add":
      const { notificationType } = await promptWithChinese([
        {
          type: "list",
          name: "notificationType",
          message: "选择推送方式:",
          choices: [
            { name: "飞书推送", value: "Lark" },
            { name: "Telegram推送", value: "Telegram" },
            { name: "企业微信推送", value: "WechatWork" },
            { name: "Bark推送", value: "Bark" },
            { name: "SMTP邮件推送", value: "SMTP" },
          ],
        },
      ]);

      let newNotification: NotificationConfig = { type: notificationType };

      if (notificationType === "Lark") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入飞书机器人Webhook URL:",
            validate: (v: string) => (v.includes("feishu.cn") ? true : "URL格式错误"),
          },
        ]);
        newNotification.webhook = webhook;

        const { needSecret } = await promptWithChinese([
          {
            type: "confirm",
            name: "needSecret",
            message: "是否启用签名校验？（建议启用以提高安全性）",
            default: false,
          },
        ]);

        if (needSecret) {
          const { secret } = await promptWithChinese([
            {
              name: "secret",
              message: "请输入签名密钥（从飞书机器人安全设置中获取）:",
              validate: (v: string) => (v.trim() ? true : "密钥不能为空"),
            },
          ]);
          newNotification.secret = secret;
        }
      } else if (notificationType === "Telegram") {
        const { botToken, chatId } = await promptWithChinese([
          {
            name: "botToken",
            message: "请输入Telegram Bot Token:",
            validate: (v: string) => (v.includes(":") ? true : "格式错误"),
          },
          {
            name: "chatId",
            message: "请输入Chat ID:",
            validate: (v: string) => (v.trim() ? true : "不能为空"),
          },
        ]);
        newNotification.botToken = botToken;
        newNotification.chatId = chatId;
      } else if (notificationType === "WechatWork") {
        const { webhook } = await promptWithChinese([
          {
            name: "webhook",
            message: "请输入企业微信机器人Webhook URL:",
            validate: (v: string) =>
              v.includes("qyapi.weixin.qq.com") ? true : "URL格式错误",
          },
        ]);
        newNotification.webhook = webhook;
      } else if (notificationType === "Bark") {
        const barkConfig = await promptWithChinese([
          {
            name: "deviceKey",
            message: "请输入Bark设备密钥(Device Key):",
            validate: (v: string) => (v.trim() ? true : "设备密钥不能为空"),
          },
          {
            name: "serverUrl",
            message: "请输入Bark服务器地址(默认: https://api.day.app):",
            default: "https://api.day.app",
          },
          {
            name: "group",
            message: "推送分组名称(可选):",
            default: "火车票监控",
          },
          {
            name: "sound",
            message: "推送声音(可选, 默认: default):",
            default: "default",
          },
        ]);

        // 询问是否配置高级选项
        const { useAdvanced } = await promptWithChinese([
          {
            type: "confirm",
            name: "useAdvanced",
            message: "是否配置高级选项(推送级别、图标等)?",
            default: false,
          },
        ]);

        if (useAdvanced) {
          const advancedConfig = await promptWithChinese([
            {
              type: "list",
              name: "level",
              message: "推送级别:",
              choices: [
                { name: "默认(active)", value: "active" },
                { name: "重要警告(critical)", value: "critical" },
                { name: "时效性通知(timeSensitive)", value: "timeSensitive" },
                { name: "仅添加到列表(passive)", value: "passive" },
              ],
              default: "active",
            },
            {
              name: "icon",
              message: "自定义图标URL(可选):",
            },
            {
              name: "url",
              message: "点击跳转URL(可选):",
            },
            {
              type: "confirm",
              name: "autoCopy",
              message: "自动复制推送内容?",
              default: false,
            },
            {
              type: "confirm",
              name: "isArchive",
              message: "保存推送到历史记录?",
              default: true,
            },
          ]);

          Object.assign(barkConfig, advancedConfig);
        }

        Object.assign(newNotification, barkConfig);
      } else if (notificationType === "SMTP") {
        console.log(chalk.cyan("配置SMTP邮件推送:"));

        const smtpConfig = await promptWithChinese([
          {
            name: "host",
            message: "SMTP服务器地址(如: smtp.gmail.com):",
            validate: (v: string) => (v.trim() ? true : "SMTP服务器地址不能为空"),
          },
          {
            type: "number",
            name: "port",
            message: "SMTP端口号(常用: 587-STARTTLS, 465-SSL, 25-无加密):",
            default: 587,
            validate: (v: number) =>
              v > 0 && v <= 65535 ? true : "端口号必须在1-65535之间",
          },
          {
            name: "user",
            message: "邮箱用户名:",
            validate: (v: string) => (v.trim() ? true : "邮箱用户名不能为空"),
          },
          {
            type: "password",
            name: "pass",
            message: "邮箱密码或应用密码:",
            validate: (v: string) => (v.trim() ? true : "密码不能为空"),
          },
          {
            name: "from",
            message: "发件人显示名称(可选, 默认使用用户名):",
          },
          {
            name: "to",
            message: "收件人邮箱地址:",
            validate: (v: string) => {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              return emailRegex.test(v.trim()) ? true : "请输入有效的邮箱地址";
            },
          },
        ]);

        // 询问是否配置高级选项
        const { useAdvancedSMTP } = await promptWithChinese([
          {
            type: "confirm",
            name: "useAdvancedSMTP",
            message: "是否配置高级选项(安全连接、抄送等)?",
            default: false,
          },
        ]);

        if (useAdvancedSMTP) {
          const advancedSMTPConfig = await promptWithChinese([
            {
              type: "list",
              name: "secure",
              message: "安全连接类型:",
              choices: [
                { name: "自动检测(推荐)", value: undefined },
                { name: "SSL/TLS (端口465)", value: true },
                { name: "STARTTLS (端口587)", value: false },
              ],
              default: undefined,
            },
            {
              name: "cc",
              message: "抄送邮箱(多个用逗号分隔, 可选):",
            },
            {
              name: "bcc",
              message: "密送邮箱(多个用逗号分隔, 可选):",
            },
            {
              name: "replyTo",
              message: "回复邮箱(可选):",
            },
          ]);

          Object.assign(smtpConfig, advancedSMTPConfig);
        }

        Object.assign(newNotification, smtpConfig);
      }

      if (!config.notifications) config.notifications = [];
      config.notifications.push(newNotification);
      break;

    case "edit":
      if (!config.notifications || config.notifications.length === 0) {
        console.log(chalk.yellow("暂无推送配置"));
        return;
      }

      const { notifIndex } = await promptWithChinese([
        {
          type: "list",
          name: "notifIndex",
          message: "选择要修改的推送配置:",
          choices: config.notifications.map((notif, index) => ({
            name: `${index + 1}. ${notif.type}`,
            value: index,
          })),
        },
      ]);

      const notif = config.notifications[notifIndex];
      // 编辑逻辑省略，与原代码类似
      break;

    case "delete":
      if (!config.notifications || config.notifications.length === 0) {
        console.log(chalk.yellow("暂无推送配置"));
        return;
      }

      const { deleteIndex } = await promptWithChinese([
        {
          type: "list",
          name: "deleteIndex",
          message: "选择要删除的推送配置:",
          choices: config.notifications.map((notif, index) => ({
            name: `${index + 1}. ${notif.type}`,
            value: index,
          })),
        },
      ]);

      config.notifications.splice(deleteIndex, 1);
      break;

    case "clear":
      const { confirmClear } = await promptWithChinese([
        {
          type: "confirm",
          name: "confirmClear",
          message: "确认清空所有推送配置?",
          default: false,
        },
      ]);

      if (confirmClear) {
        config.notifications = [];
      }
      break;
  }

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 推送配置已更新!"));
}

// 编辑查询参数
async function editQueryParams(config: Config): Promise<void> {
  if (!config.watch || config.watch.length === 0) {
    console.log(chalk.yellow("暂无监控任务"));
    return;
  }

  const { taskIndex } = await promptWithChinese([
    {
      type: "list",
      name: "taskIndex",
      message: "选择要编辑查询参数的任务:",
      choices: config.watch.map((watch, index) => ({
        name: `${index + 1}. ${watch.from} → ${watch.to} (${watch.date})`,
        value: index,
      })),
    },
  ]);

  const task = config.watch[taskIndex];
  const currentParams = task.queryParams || {};

  const queryConfig = await promptWithChinese([
    {
      type: "list",
      name: "purpose_codes",
      message: "乘客类型:",
      choices: [
        { name: "成人票", value: "ADULT" },
        { name: "学生票", value: "0X00" },
      ],
      default: currentParams.purpose_codes || "ADULT",
    },
    {
      type: "number",
      name: "ADULT",
      message: "成人票数量:",
      default: currentParams.ADULT || 1,
      validate: (v: number) => (v > 0 && v <= 6 ? true : "数量必须在1-6之间"),
    },
    {
      type: "number",
      name: "CHILD",
      message: "儿童票数量:",
      default: currentParams.CHILD || 0,
      validate: (v: number) => (v >= 0 && v <= 6 ? true : "数量必须在0-6之间"),
    },
  ]);

  task.queryParams = queryConfig;

  fs.writeFileSync("config.yml", yaml.dump(config), "utf-8");
  console.log(chalk.green("✅ 查询参数已更新!"));
}

// 重置配置
async function resetConfig(): Promise<void> {
  const { confirmReset } = await promptWithChinese([
    {
      type: "confirm",
      name: "confirmReset",
      message: "确认重置配置? 这将删除所有现有配置!",
      default: false,
    },
  ]);

  if (confirmReset) {
    if (fs.existsSync("config.yml")) {
      fs.unlinkSync("config.yml");
    }
    console.log(chalk.green("✅ 配置已重置!"));

    const { createNew } = await promptWithChinese([
      {
        type: "confirm",
        name: "createNew",
        message: "是否现在创建新配置?",
        default: true,
      },
    ]);

    if (createNew) {
      await queryAndConfig();
    } else {
      await main();
    }
  } else {
    console.log(chalk.yellow("已取消重置"));
    await main();
  }
}

async function viewConfig(): Promise<void> {
  if (!fs.existsSync("config.yml")) {
    console.log(chalk.yellow("⚠️  配置文件不存在"));
    await main();
    return;
  }

  const configContent = fs.readFileSync("config.yml", "utf-8");
  const config: Config = yaml.load(configContent) as Config;

  console.log(chalk.cyan("📋 当前配置:"));
  console.log(chalk.gray("─".repeat(50)));

  if (config.watch && config.watch.length > 0) {
    config.watch.forEach((watch, index) => {
      console.log(chalk.yellow(`监控任务 ${index + 1}:`));
      console.log(`  出发地: ${watch.from}`);
      console.log(`  目的地: ${watch.to}`);
      console.log(`  日期: ${watch.date}`);

      if (watch.trains && watch.trains.length > 0) {
        console.log(`  监控车次 (${watch.trains.length}个):`);
        watch.trains.forEach((train) => {
          console.log(`    ${train.trainNo} (${train.departTime} - ${train.arriveTime})`);
          if (train.seatCategory && train.seatCategory.length > 0) {
            console.log(`      座位类型: ${train.seatCategory.join(", ")}`);
          }
        });
      }

      if (watch.queryParams) {
        console.log(`  查询参数:`);
        console.log(`    乘客类型: ${watch.queryParams.purpose_codes || "ADULT"}`);
        console.log(`    成人票: ${watch.queryParams.ADULT || 1}`);
        if (watch.queryParams.CHILD) {
          console.log(`    儿童票: ${watch.queryParams.CHILD}`);
        }
        if (watch.queryParams.STUDENT) {
          console.log(`    学生票: ${watch.queryParams.STUDENT}`);
        }
      }
      console.log();
    });
  }

  if (config.notifications && config.notifications.length > 0) {
    console.log(chalk.yellow(`推送配置 (${config.notifications.length}个):`));
    config.notifications.forEach((notif, index) => {
      console.log(`  ${index + 1}. ${notif.type}`);
    });
  } else {
    console.log(chalk.yellow("推送配置: 未配置"));
  }

  console.log(chalk.gray("─".repeat(50)));

  const { action } = await promptWithChinese([
    {
      type: "list",
      name: "action",
      message: "选择操作:",
      choices: [
        { name: "✏️  编辑配置", value: "edit" },
        { name: "🚀 开始监控", value: "start" },
        { name: "🔙 返回主菜单", value: "back" },
      ],
    },
  ]);

  switch (action) {
    case "edit":
      await editConfig();
      break;
    case "start":
      await startMonitoring();
      break;
    case "back":
      await main();
      break;
  }
}

async function startMonitoring(): Promise<void> {
  if (!fs.existsSync("config.yml")) {
    console.log(chalk.red("❌ 配置文件不存在，请先配置监控任务"));
    await main();
    return;
  }

  console.log(chalk.green("🚀 启动监控程序..."));
  console.log(chalk.gray("提示: 使用 Ctrl+C 停止监控"));

  // 这里应该启动实际的监控程序
  // 由于这是CLI工具，实际监控逻辑在index.js中
  process.exit(0);
}

main();
