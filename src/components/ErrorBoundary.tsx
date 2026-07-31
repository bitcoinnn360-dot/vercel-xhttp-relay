import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  name?: string
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Prevents one section crash from blanking the whole dashboard. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || 'section'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel px-4 py-3 text-sm text-[var(--color-neg)]">
          خطا در نمایش {this.props.name || 'این بخش'}. بقیه داشبورد در دسترس است.
          <button
            type="button"
            className="ms-3 underline"
            onClick={() => this.setState({ error: null })}
          >
            تلاش مجدد
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
