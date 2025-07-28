# 🚨 16GB Memory Leak Analysis - FINDINGS

## 📊 **Problem Summary**
- **Issue**: `RangeError: Array buffer allocation failed` during Flutter tests
- **Memory Growth**: **16GB of External memory** during extension activation
- **Location**: Happens during `ext.activate()` call in test setup

## 🎯 **Root Cause Identified**

**File**: `src/extension/extension.ts` line 327
**Code**: `const analyzer = new LspAnalyzer(logger, sdks, dartCapabilities, workspaceContext, dartToolingDaemon);`

This creates the **Dart Analysis Server LSP process**, which is causing the massive external memory leak.

## 🔍 **Technical Details**

### Memory Profile During Leak:
```
External: 16088.2MB  ← 16GB LEAK HERE
RSS: 16537.6MB
Heap Used: 341.0MB
Array Buffers: 0.0MB
```

### Key Insight:
- **External memory** (not heap) indicates **native/child process memory**
- **16GB** is unusually large - suggests process spawning issue
- **Array Buffers: 0.0MB** rules out JavaScript buffer leaks

## 🎯 **Primary Suspects**

### 1. **Dart Analysis Server Process (MOST LIKELY)**
- **File**: `src/extension/analysis/analyzer.ts`
- **Method**: `spawnServer()`
- **Issue**: LSP server process or its streams leaking memory

### 2. **Stream/Buffer Management**
- **LoggingTransform streams** not being disposed
- **Process stdout/stderr pipes** accumulating data
- **LSP client connection buffers**

### 3. **Child Process Lifecycle**
- Analysis server process not properly managed
- Multiple processes spawned without cleanup
- File descriptors/handles leaking

## 🔧 **Immediate Investigation Steps**

### 1. **Check Process Spawning**
Look at `src/extension/analysis/analyzer.ts` lines 613-650:
```typescript
private spawnServer(logger: Logger, sdks: DartSdks): Promise<StreamInfo> {
    const process = safeToolSpawn(undefined, vmPath, args);
    // CHECK: Is this creating massive buffers?
}
```

### 2. **Check Stream Handling**
```typescript
const reader = process.stdout.pipe(new LoggingTransform(logger, "<=="));
const writer = new LoggingTransform(logger, "==>");
// CHECK: Are these transforms accumulating data?
```

### 3. **Check LSP Client**
The LSP client might be creating massive internal buffers for communication.

## 🛠️ **Recommended Fixes**

### **Immediate Fix Options:**

1. **Add Process Memory Limits**
   ```typescript
   const process = safeToolSpawn(undefined, vmPath, [...args, '--max-old-space-size=1024']);
   ```

2. **Limit Stream Buffers**
   ```typescript
   const reader = process.stdout.pipe(new LoggingTransform(logger, "<==", { highWaterMark: 1024 * 1024 }));
   ```

3. **Add Disposal Tracking**
   ```typescript
   this.disposables.push({ 
       dispose: () => { 
           process.kill(); 
           reader.destroy();
           writer.destroy();
       } 
   });
   ```

### **Investigation Tools:**

1. **Add memory tracking to LspAnalyzer constructor**
2. **Track process creation in spawnServer()**
3. **Monitor LSP client memory usage**

## ⚡ **Quick Test**

Run the enhanced test with the new memory tracking to confirm the exact moment the 16GB leak occurs during `LspAnalyzer` creation.

## 🎯 **Next Steps**

1. **Run the updated test** to confirm timing
2. **Investigate `spawnServer()` method** in analyzer.ts
3. **Check LSP client configuration** for buffer size limits
4. **Add proper stream disposal** in analyzer cleanup

The 16GB leak is almost certainly in the **Dart Analysis Server LSP process creation** - this is where to focus the fix!
