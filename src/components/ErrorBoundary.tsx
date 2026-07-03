import React, { Component, ReactNode } from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // You can also send the error to an error reporting service here
    Alert.alert(
      'An error occurred',
      'Something went wrong. Please try again later.',
      [{ text: 'OK' }]
    );
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackText}>
            Something went wrong. Please try again later.
          </Text>
          <Button title="Retry" onPress={() => this.setState({ hasError: false })} />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  fallbackText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
});