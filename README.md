# @itsyuyi/dsh-approval-sound

当会话中出现**待授权的提示**（或等待用户回答的问题）时，播放系统提示音。

## 开关在哪里设置

**图形界面**：Web GUI `设置 → 插件 → 授权提示音` 标签页（Settings → Plugins → Approval Sound），提供：

- `enabled` —— 总开关
- `approvals` —— 待授权请求是否触发提示音
- `questions` —— 等待用户回答的问题是否触发
- `sound` —— `'system'` 或音频文件绝对路径
- `cooldownMs` —— 冷却时间（毫秒）
- 「试听」按钮 —— 立即播放一次当前提示音

所有修改**即时生效**（写入本目录的 `config.json`，宿主监听该文件），无需重启。

**其他方式**：

1. 「插件」页（Plugin Manager）停用 / 启用本插件 = 总开关，立即生效。
2. 直接编辑本目录的 `config.json`，保存后 1 秒内生效（文件被监听）。
3. `cordis.patch.yml` 的行配置作为基础层（GUI / `config.json` 优先）。

> 说明：本地 `link:` 方式安装的工作区包，**修改代码**后需要重启 DSH 宿主才能加载新的模块代次（Node ESM 模块缓存）；**修改配置**不需要重启。

## 工作原理

插件在宿主端监听两个 waterfall 事件，仅做“观察”，绝不抢答：

- `approval/request` —— 权限 / 沙箱授权请求（如文件操作升级授权）
- `user-questions/request` —— `ask_user_question` 提示（含计划审批）

监听器播放提示音后总是调用 `next()` 并把结果原样返回，因此授权流程本身不受任何影响；播放失败也只会被静默吞掉，不会导致授权失败（fail closed）。

## 配置层（后者优先）

1. 内置默认值
2. `cordis.patch.yml` 的行 `config`
3. 本目录 `config.json`（设置页写入或手动编辑，监听热更新）

```jsonc
// config.json
{
  "enabled": true,      // 总开关
  "approvals": true,    // 待授权请求触发提示音
  "questions": true,    // 等待用户回答的问题也触发
  "sound": "system",    // 'system' 用系统默认提示音；或音频文件的绝对路径
  "cooldownMs": 1500    // 上次播放后多久内的新请求不重复播放
}
```

### 各平台默认提示音

| 平台 | 命令 |
|---|---|
| macOS | `afplay /System/Library/Sounds/Ping.aiff`（回退 Glass、`osascript beep`） |
| Linux | `canberra-gtk-play -i dialog-warning`（回退 `paplay` freedesktop 声音、`aplay`） |
| Windows | PowerShell `[System.Media.SystemSounds]::Asterisk.Play()` |

自定义 `sound` 路径时：macOS 走 `afplay`；Linux 依次尝试 `paplay` / `pw-play` / `aplay` / `ffplay`；Windows 走 PowerShell `SoundPlayer`（仅 WAV）。
