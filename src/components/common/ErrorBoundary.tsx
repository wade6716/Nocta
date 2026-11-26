import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React Error Boundary]', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '#/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-screen bg-[#F5F5F7] dark:bg-[#0f1115] text-[#1D1D1F] dark:text-white flex flex-col items-center justify-center p-8 select-none">
          <div className="max-w-md w-full bg-white dark:bg-[#161922] border border-red-500/25 dark:border-red-500/30 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-500/15 dark:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold">
              {this.props.fallbackTitle || '页面遇到问题'}
            </h2>
            <div className="p-3 bg-black/[0.04] dark:bg-black/40 rounded-xl text-left max-h-40 overflow-y-auto">
              <p className="text-xs font-mono text-red-700 dark:text-red-300 break-all">
                {this.state.error?.message || '未知渲染错误'}
              </p>
            </div>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-2.5 bg-black/[0.06] hover:bg-black/[0.11] dark:bg-white/10 dark:hover:bg-white/20 text-[#1D1D1F] dark:text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>刷新应用</span>
              </button>
              <button
                onClick={this.handleReset}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>返回首页</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
