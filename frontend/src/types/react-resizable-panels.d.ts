declare module 'react-resizable-panels' {
  import * as React from 'react';

  export interface PanelGroupProps {
    direction?: 'horizontal' | 'vertical';
    layout?: number[];
    onLayout?: (sizes: number[]) => void;
    autoSaveId?: string;
    className?: string;
    children?: React.ReactNode;
  }

  export interface PanelProps {
    defaultSize?: number;
    minSize?: number;
    maxSize?: number;
    className?: string;
    children?: React.ReactNode;
  }

  export interface PanelResizeHandleProps {
    className?: string;
  }

  export const PanelGroup: React.FC<PanelGroupProps>;
  export const Panel: React.FC<PanelProps>;
  export const PanelResizeHandle: React.FC<PanelResizeHandleProps>;
}

