#!/bin/bash

# Create the .pbxproj bundle structure
mkdir -p ChaseMapper.xcodeproj

cat > ChaseMapper.xcodeproj/project.pbxproj << 'PBXPROJ'
// !$*UTF8*$!
{
archiveVersion = 1;
classes = {
};
objectVersion = 56;
objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
/* End PBXFileReference section */
/* Begin PBXFrameworksBuildPhase section */
/* End PBXFrameworksBuildPhase section */
/* Begin PBXGroup section */
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
/* End PBXNativeTarget section */
/* Begin PBXProject section */
/* End PBXProject section */
/* Begin PBXSourcesBuildPhase section */
/* End PBXSourcesBuildPhase section */
/* Begin XCBuildConfiguration section */
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
/* End XCConfigurationList section */
};
rootObject = 1F1;
}
PBXPROJ

cat > ChaseMapper.xcodeproj/xcshareddata/xcschemes/ChaseMapper.xcscheme << 'XCSCHEME'
<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1500" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "1F2" BuildableName = "ChaseMapper.app" BlueprintName = "ChaseMapper" ReferencedContainer = "container:ChaseMapper.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <LaunchAction selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLaunchConfiguration = "Debug" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "1F2" BuildableName = "ChaseMapper.app" BlueprintName = "ChaseMapper" ReferencedContainer = "container:ChaseMapper.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <TestAction selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLaunchConfiguration = "Debug" shouldUseLaunchSchemeArgsEnv = "YES" shouldAutocreateTestPlan = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "1F2" BuildableName = "ChaseMapper.app" BlueprintName = "ChaseMapper" ReferencedContainer = "container:ChaseMapper.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </TestAction>
   <ArchiveAction archiveTeamID = "">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "1F2" BuildableName = "ChaseMapper.app" BlueprintName = "ChaseMapper" ReferencedContainer = "container:ChaseMapper.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ArchiveAction>
</Scheme>
XCSCHEME

echo "Xcode project structure created"
