import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: '播放与桌面手势',
    items: [
      { key: 'Space / 单击', desc: '播放 / 暂停' },
      { key: '← / →', desc: '快退 / 快进 5 秒' },
      { key: '长按 →', desc: '临时倍速快进，松手恢复' },
      { key: '↑ / ↓ / 滚轮', desc: '音量调节 (±5% / 最高 200%)' },
      { key: 'Shift + 滚轮', desc: '精确微调进度 (±5 秒)' },
      { key: 'M', desc: '静音 / 取消静音' },
      { key: '[ / ] / \\', desc: '减速 / 加速 / 重置 1.0x' },
    ],
  },
  {
    title: '弹幕控制',
    items: [
      { key: 'D', desc: '开启 / 隐藏弹幕' },
      { key: 'G / H', desc: '弹幕时间偏移 -0.5s / +0.5s' },
    ],
  },
  {
    title: '音字幕与逐帧工具',
    items: [
      { key: 'C / A', desc: '轮换字幕流 / 轮换音轨' },
      { key: 'Z / X', desc: '字幕时间偏移 -0.5s / +0.5s' },
      { key: ', / .', desc: '暂停后上一帧 / 下一帧' },
      { key: '拖放文件', desc: '拖入本地 .srt/.ass/.vtt 外挂字幕' },
    ],
  },
  {
    title: '追番与窗口交互',
    items: [
      { key: 'L', desc: '快捷跳过片头' },
      { key: 'P / N', desc: '切换上一集 / 下一集' },
      { key: 'T', desc: '播放器窗口置顶 / 取消置顶' },
      { key: 'S', desc: '保存当前无损 PNG 截图' },
      { key: 'I', desc: '实时硬解与解码遥测面板' },
      { key: 'F / 双击', desc: '进入 / 退出全屏' },
      { key: 'Esc / ?', desc: '关闭浮层或返回 / 快捷键面板' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/[0.14] rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-400/25 text-sky-400">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">快捷键与手势指南</h3>
              <p className="text-[11px] text-slate-400">高沉浸低打扰操作 · 单手键盘与鼠标全掌控</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-5 custom-scrollbar">
          {SHORTCUT_GROUPS.map((group) => (
            <div
              key={group.title}
              className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3"
            >
              <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
                {group.title}
              </h4>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-slate-300">{item.desc}</span>
                    <kbd className="shrink-0 px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.1] font-mono text-[11px] text-slate-100">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShortcutsModal;
