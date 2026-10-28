import * as f from "../../shared/flutter/daemon_interfaces";
import { CustomEmulator, CustomEmulatorDefinition, Emulator, EmulatorCreator } from "../../shared/interfaces";

export const desktop: f.Device & { platformType: string } = {
	category: "desktop",
	emulator: false,
	emulatorId: undefined,
	ephemeral: false,
	id: "my-mac",
	name: "My MacBook",
	platform: "darwin-x64",
	platformType: "macos",
	type: "device",
};

export const webChrome: f.Device & { platformType: string } = {
	category: "web",
	emulator: false,
	emulatorId: undefined,
	ephemeral: false,
	id: "chrome",
	name: "Chrome",
	platform: "web-javascript",
	platformType: "web",
	type: "device",
};

export const webServer: f.Device & { platformType: string } = {
	category: "web",
	emulator: false,
	emulatorId: undefined,
	ephemeral: false,
	id: "web-server",
	name: "Web Server",
	platform: "web-javascript",
	platformType: "web",
	type: "device",
};

export const physicalAndroidMobile: f.Device = {
	category: "mobile",
	emulator: false,
	emulatorId: undefined,
	ephemeral: true,
	id: "my-eyephone",
	name: "My eyePhone",
	platform: "android-x64",
	platformType: "android",
	type: "device",
};

export const emulatedAndroidMobile: f.Device = {
	category: "mobile",
	emulator: true,
	emulatorId: "my_emulator_id",
	ephemeral: true,
	id: "android-pixel-7",
	name: "Pixel 7",
	platform: "android-x87",
	platformType: "android",
	type: "device",
};

export const androidEmulator: Emulator = {
	category: "mobile",
	id: "my_emulator_id",
	name: "My Cool Emulator!",
	platformType: "android",
	type: "emulator",
};

export const androidEmulatorToOverride: f.FlutterEmulator = {
	category: "mobile",
	id: "my_emulator_id_to_override",
	name: "WILL BE OVERRIDEN EMULATOR",
	platformType: "android",
};

export const androidBogusEmulatorName: f.FlutterEmulator = {
	category: "mobile",
	id: "my_bogus_emulator",
	name: "INFO     | my error message https://github.com/Dart-Code/Dart-Code/issues/5052",
	platformType: "android",
};

export const androidBogusEmulatorId: f.FlutterEmulator = {
	category: "mobile",
	id: "INFO     | my_bogus_emulator",
	name: "My bogus emulator",
	platformType: "android",
};

export const emulatediOSMobile: f.Device = {
	category: "mobile",
	emulator: true,
	emulatorId: "my_emulator_id",
	ephemeral: true,
	id: "ios-simulator",
	name: "iOS Simulator",
	platform: "ios-something",
	platformType: "ios",
	type: "device",
};

export const customEmulator1: CustomEmulatorDefinition = {
	args: ["args"],
	executable: "echo",
	id: "my-custom-emulator",
	name: "My custom emulator",
};

export const customEmulator2: CustomEmulatorDefinition = {
	args: ["args"],
	executable: "echo",
	id: "my_emulator_id_to_override",
	name: "My emulator override",
};

export const customEmulators = [customEmulator1, customEmulator2];

export const customEmulator: CustomEmulator = {
	...customEmulator1,
	category: "custom",
	type: "custom-emulator",
};

export const emulatorCreator: EmulatorCreator = {
	platformType: "android",
	type: "emulator-creator",
};
