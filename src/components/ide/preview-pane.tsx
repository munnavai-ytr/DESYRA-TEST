'use client';

import React, { useState } from 'react';
import { Smartphone, Tablet, Monitor, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

interface DeviceOption {
  id: DeviceMode;
  label: string;
  width: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DEVICE_OPTIONS: DeviceOption[] = [
  { id: 'mobile', label: 'Phone', width: '390px', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', width: '768px', icon: Tablet },
  { id: 'desktop', label: 'Desktop', width: '100%', icon: Monitor },
];

export function PreviewPane() {
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');

  const currentOption = DEVICE_OPTIONS.find((d) => d.id === deviceMode) || DEVICE_OPTIONS[2];

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] overflow-hidden select-none">
      {/* Preview Toolbar */}
      <div className="h-9 px-3 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
            Device
          </span>
          <span className="text-[10px] text-[var(--disabled)] font-mono">
            ({currentOption.width})
          </span>
        </div>

        {/* Device Switcher Segmented Control */}
        <div className="flex items-center bg-[var(--elevated)] border border-[var(--border)] rounded-[var(--radius-sm)] p-0.5">
          {DEVICE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = deviceMode === opt.id;
            return (
              <Tooltip key={opt.id} content={`${opt.label} (${opt.width})`} position="bottom">
                <button
                  type="button"
                  onClick={() => setDeviceMode(opt.id)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[var(--surface)] text-[var(--text)] font-medium shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[11px]">{opt.label}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Frame Container - Scrollable if device width exceeds pane */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-start justify-center bg-[var(--bg)]">
        <div
          style={{ width: currentOption.width }}
          className={`h-full min-h-[460px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] flex flex-col items-center justify-center p-6 shadow-xl transition-all duration-200 relative overflow-hidden ${
            deviceMode === 'desktop' ? 'w-full' : ''
          }`}
        >
          {/* Subtle top frame notch / bar simulation for mobile/tablet */}
          {deviceMode !== 'desktop' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-1 bg-[var(--border)] rounded-full" />
          )}

          <div className="text-center max-w-sm">
            <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4 text-[var(--muted)]">
              <Eye className="w-6 h-6 text-[var(--accent)]" />
            </div>

            <div className="flex items-center justify-center gap-2 mb-2">
              <h3 className="text-base font-semibold text-[var(--text)] tracking-tight">
                Live Preview
              </h3>
              <Badge variant="info" size="sm">
                Coming soon
              </Badge>
            </div>

            <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
              Live preview arrives in Push 6. The interactive execution sandbox with hot-reloading and console tools will render here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
