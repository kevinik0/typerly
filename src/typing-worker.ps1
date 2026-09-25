$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class TyperlyKeyboard
{
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const ushort VK_RETURN = 0x0D;
    private const ushort VK_TAB = 0x09;
    private static int excludedProcessId;
    private static long lastExternalWindow;
    private static int monitorStarted;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")]
    private static extern uint GetWindowThreadProcessIdWithProcess(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint source, uint target, bool attach);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    public static void StartWindowMonitor(int processId)
    {
        excludedProcessId = processId;
        if (Interlocked.Exchange(ref monitorStarted, 1) == 1) return;

        var monitor = new Thread(() =>
        {
            while (true)
            {
                var foreground = GetForegroundWindow();
                if (foreground != IntPtr.Zero && IsWindowVisible(foreground))
                {
                    uint ownerProcess;
                    GetWindowThreadProcessIdWithProcess(foreground, out ownerProcess);
                    var className = new StringBuilder(128);
                    GetClassName(foreground, className, className.Capacity);
                    string windowClass = className.ToString();
                    bool isShell = windowClass == "Shell_TrayWnd" || windowClass == "Progman" || windowClass == "WorkerW";
                    if (ownerProcess != excludedProcessId && !isShell)
                        Interlocked.Exchange(ref lastExternalWindow, foreground.ToInt64());
                }
                Thread.Sleep(75);
            }
        });
        monitor.IsBackground = true;
        monitor.Start();
    }

    public static bool FocusLastWindow()
    {
        long handle = Interlocked.Read(ref lastExternalWindow);
        if (handle == 0) return true;
        return FocusWindow(handle);
    }

    public static bool FocusWindow(long handle)
    {
        var target = new IntPtr(handle);
        if (!IsWindow(target)) return false;
        if (IsIconic(target)) ShowWindowAsync(target, 9);

        for (int attempt = 0; attempt < 3; attempt++)
        {
            if (GetForegroundWindow() == target) return true;
            uint currentThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
            uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
            AttachThreadInput(currentThread, foregroundThread, true);
            AttachThreadInput(currentThread, targetThread, true);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetFocus(target);
            AttachThreadInput(currentThread, targetThread, false);
            AttachThreadInput(currentThread, foregroundThread, false);
            Thread.Sleep(100);
        }
        return GetForegroundWindow() == target;
    }

    private static void SendVirtualKey(ushort key)
    {
        var inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk = key;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].u.ki.wVk = key;
        inputs[1].u.ki.dwFlags = KEYEVENTF_KEYUP;
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    private static void SendUnicode(char character)
    {
        var inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki.wScan = character;
        inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].u.ki.wScan = character;
        inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void Type(string text, int delayMs)
    {
        bool previousWasCarriageReturn = false;
        foreach (char character in text)
        {
            if (character == '\n' && previousWasCarriageReturn)
            {
                previousWasCarriageReturn = false;
                continue;
            }

            if (character == '\r' || character == '\n') SendVirtualKey(VK_RETURN);
            else if (character == '\t') SendVirtualKey(VK_TAB);
            else SendUnicode(character);

            previousWasCarriageReturn = character == '\r';
            if (delayMs > 0) Thread.Sleep(delayMs);
        }
    }
}
'@

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine('READY')
[Console]::Out.Flush()

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $parts = $line.Split('|')
        if ($parts[0] -eq 'MONITOR' -and $parts.Count -eq 2) {
            [TyperlyKeyboard]::StartWindowMonitor([int]$parts[1])
            continue
        }
        $focusedExplicitly = $false
        if ($parts[0] -eq 'TYPEAT' -and $parts.Count -eq 5) {
            if (-not [TyperlyKeyboard]::FocusWindow([long]$parts[3])) { throw 'Could not focus the target window.' }
            $focusedExplicitly = $true
            $parts = @('TYPE', $parts[1], $parts[2], $parts[4])
        }
        if ($parts.Count -ne 4 -or $parts[0] -ne 'TYPE') { continue }
        $id = $parts[1]
        $delay = [Math]::Max(0, [Math]::Min(250, [int]$parts[2]))
        $text = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($parts[3]))
        if (-not $focusedExplicitly -and -not [TyperlyKeyboard]::FocusLastWindow()) { throw 'Could not restore the target window.' }
        [TyperlyKeyboard]::Type($text, $delay)
        [Console]::WriteLine("DONE|$id")
        [Console]::Out.Flush()
    } catch {
        $safeMessage = $_.Exception.Message.Replace('|', '/').Replace("`r", ' ').Replace("`n", ' ')
        [Console]::WriteLine("ERROR|$id|$safeMessage")
        [Console]::Out.Flush()
    }
}
