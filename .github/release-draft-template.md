## 下载说明

- Windows：下载 `Folia-Setup-{{VERSION}}.exe`
- macOS：
  - Apple Silicon：下载 `Folia-{{VERSION}}-arm64.dmg`
  - Intel Mac：下载 `Folia-{{VERSION}}-x64.dmg`
  - 如果打开时提示“应用已损坏”，这通常是当前 macOS 包未签名 / 未 notarize 导致的 Gatekeeper 拦截，不是安装包本身损坏。解决方法见[这份说明]({{MACOS_UNSIGNED_HELP_URL}})
- Linux：
  - Arch Linux / Manjaro：通过 AUR 安装 `yay -S folia-major-bin`
  - Debian / Ubuntu：下载 `folia-major-{{VERSION}}-linux-amd64.deb`
  - Fedora / openSUSE：下载 `folia-major-{{VERSION}}-linux-x86_64.rpm`
  - 其他发行版：下载 `folia-major-{{VERSION}}-linux-x64.tar.gz`

## 更新说明

- 合入原作者 0.7.18 与 0.7.19 更新：墙面播放队列、歌词可视化性能与本地切歌优化、Bravais 歌手和专辑海报、在线播放失败原因说明、中日文歌词分词优化、网页离线启动及桌面 AI 密钥加密保存。
- 继续支持桌面版 YouTube Music，可连接账号、搜索播放歌曲并浏览个人歌单；暂不提供 YouTube Music 歌词。
- 后续上游改进：HTDemucs 音频分离改用 NumPy 计算 STFT/iSTFT，支持 Intel Mac。

_那些永恒的价值，正存在于这些无法复制的事物中_
