import { ConfigManager } from "./config.js";
import { NotificationManager } from "./notifications.js";
import { QueryService } from "./query.js";
import { log, sleep, asset } from "./utils.js";

async function main() {
  // 1. 加载配置
  const configManager = ConfigManager.getInstance();
  const config = configManager.load();

  log.title("CRTMonitor 启动中...");
  log.info(`查询间隔: ${config.interval}分钟`);
  log.info(`API延迟: ${config.delay}秒`);

  // 2. 初始化通知管理器
  const notificationManager = new NotificationManager(config.notifications);
  if (notificationManager.count === 0) {
    log.warn("未配置任何通知方式，仅在控制台输出");
  }

  // 发送启动消息
  await notificationManager.sendAll({
    time: new Date().toLocaleString(),
    content: "CRTMonitor 已启动，开始监控车票信息。"
  });

  // 3. 初始化查询服务
  const queryService = new QueryService(notificationManager);

  // 4. 开始循环
  let isRunning = true;

  // 处理退出信号
  process.on('SIGINT', async () => {
    log.info("接收到退出信号，正在清理...");
    isRunning = false;
    notificationManager.destroy();
    // ChinaRailway.clearTicketCache();
    process.exit(0);
  });

  while (isRunning) {
    log.line();
    log.info("开始新一轮查询...");

    try {
      for (let search of config.watch) {
        const collector = new Map<string, string[]>(); // 用于收集当前查询任务符合条件的车次

        // 检查search.date的时间是否属于未来15天，不是则跳过
        const searchDate = new Date(search.date);
        const now = new Date();
        if (searchDate < now || searchDate > new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)) {
          log.warn(`查询日期 ${search.date} 不在未来15天内，跳过`);
          continue;
        }

        // 转换查询参数（如将站名转为Code）
        const transformedSearch = await queryService.transformSearch(search);

        // 执行查询
        await queryService.searchTickets(transformedSearch, collector);

        // 如果当前任务有查到票，立即汇总发送
        if (collector.size > 0) {
          log.info(`任务 ${search.date} ${search.from}->${search.to} 发现 ${collector.size} 组余票，正在推送...`);

          let allTickets: string[] = [];
          for (const tickets of collector.values()) {
            allTickets.push(...tickets);
          }

          if (allTickets.length > 0) {
            const title = `🎉 发现余票: ${search.date} ${search.from} -> ${search.to}`;
            // 格式化为Markdown列表，并处理换行缩进以保持列表格式
            const content = allTickets.map(t => `- ${t.replace(/\n/g, '\n  ')}`).join("\n");

            await notificationManager.sendAll({
              title: title,
              time: new Date().toLocaleString(),
              content: content
            });
          }
        }

        // 避免请求过快
        await sleep((config.delay || 5) * 1000);
      }

      // 清理一次性缓存（如果 cr.ts 中有需要清理的）
      // ChinaRailway.clearTicketCache(); // 如果使用 MemoryCache 的 TTL，这里不需要手动清理

    } catch (e: any) {
      log.error("本轮查询发生错误:", e);
      await notificationManager.sendAll({
        time: new Date().toLocaleString(),
        content: `查询出错: ${e.message}`
      });
    }

    log.info(`本轮查询结束，等待 ${config.interval} 分钟...`);
    await sleep((config.interval || 15) * 60 * 1000);
  }
}

// 启动程序
main().catch(err => {
  log.error("程序异常退出:", err);
  process.exit(1);
});
