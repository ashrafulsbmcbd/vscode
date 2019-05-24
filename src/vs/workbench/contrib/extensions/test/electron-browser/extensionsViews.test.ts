/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { assign } from 'vs/base/common/objects';
import { generateUuid } from 'vs/base/common/uuid';
import { ExtensionsListView } from 'vs/workbench/contrib/extensions/electron-browser/extensionsViews';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { ExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/node/extensionsWorkbenchService';
import {
	IExtensionManagementService, IExtensionGalleryService, IExtensionEnablementService, IExtensionTipsService, ILocalExtension, IGalleryExtension, IQueryOptions,
	DidInstallExtensionEvent, DidUninstallExtensionEvent, InstallExtensionEvent, IExtensionIdentifier, IExtensionManagementServerService, EnablementState, ExtensionRecommendationReason, SortBy, IExtensionManagementServer
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { TestExtensionEnablementService } from 'vs/workbench/services/extensionManagement/test/electron-browser/extensionEnablementService.test';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/node/extensionGalleryService';
import { IURLService } from 'vs/platform/url/common/url';
import { Emitter } from 'vs/base/common/event';
import { IPager } from 'vs/base/common/paging';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { TestContextService, TestWindowService, TestSharedProcessService } from 'vs/workbench/test/workbenchTestServices';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IWindowService } from 'vs/platform/windows/common/windows';
import { URLService } from 'vs/platform/url/common/urlService';
import { URI } from 'vs/base/common/uri';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { SinonStub } from 'sinon';
import { IExperimentService, ExperimentService, ExperimentState, ExperimentActionType } from 'vs/workbench/contrib/experiments/node/experimentService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { ExtensionIdentifier, ExtensionType, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { ExtensionManagementServerService } from 'vs/workbench/services/extensions/electron-browser/extensionManagementServerService';


suite('ExtensionsListView Tests', () => {

	let instantiationService: TestInstantiationService;
	let testableView: ExtensionsListView;
	let installEvent: Emitter<InstallExtensionEvent>,
		didInstallEvent: Emitter<DidInstallExtensionEvent>,
		uninstallEvent: Emitter<IExtensionIdentifier>,
		didUninstallEvent: Emitter<DidUninstallExtensionEvent>;

	const localEnabledTheme = aLocalExtension('first-enabled-extension', { categories: ['Themes', 'random'] });
	const localEnabledLanguage = aLocalExtension('second-enabled-extension', { categories: ['Programming languages'] });
	const localDisabledTheme = aLocalExtension('first-disabled-extension', { categories: ['themes'] });
	const localDisabledLanguage = aLocalExtension('second-disabled-extension', { categories: ['programming languages'] });
	const localRandom = aLocalExtension('random-enabled-extension', { categories: ['random'] });
	const builtInTheme = aLocalExtension('my-theme', { contributes: { themes: ['my-theme'] } }, { type: ExtensionType.System });
	const builtInBasic = aLocalExtension('my-lang', { contributes: { grammars: [{ language: 'my-language' }] } }, { type: ExtensionType.System });

	const workspaceRecommendationA = aGalleryExtension('workspace-recommendation-A');
	const workspaceRecommendationB = aGalleryExtension('workspace-recommendation-B');
	const fileBasedRecommendationA = aGalleryExtension('filebased-recommendation-A');
	const fileBasedRecommendationB = aGalleryExtension('filebased-recommendation-B');
	const otherRecommendationA = aGalleryExtension('other-recommendation-A');

	suiteSetup(() => {
		installEvent = new Emitter<InstallExtensionEvent>();
		didInstallEvent = new Emitter<DidInstallExtensionEvent>();
		uninstallEvent = new Emitter<IExtensionIdentifier>();
		didUninstallEvent = new Emitter<DidUninstallExtensionEvent>();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(ILogService, NullLogService);
		instantiationService.stub(IWindowService, TestWindowService);

		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(IConfigurationService, new TestConfigurationService());

		instantiationService.stub(IExtensionGalleryService, ExtensionGalleryService);
		instantiationService.stub(ISharedProcessService, TestSharedProcessService);
		instantiationService.stub(IExperimentService, ExperimentService);

		instantiationService.stub(IExtensionManagementService, {
			onInstallExtension: installEvent.event,
			onDidInstallExtension: didInstallEvent.event,
			onUninstallExtension: uninstallEvent.event,
			onDidUninstallExtension: didUninstallEvent.event
		});
		instantiationService.stub(IRemoteAgentService, RemoteAgentService);

		instantiationService.stub(IExtensionManagementServerService, new class extends ExtensionManagementServerService {
			private _localExtensionManagementServer: IExtensionManagementServer = { extensionManagementService: instantiationService.get(IExtensionManagementService), label: 'local', authority: 'vscode-local' };
			constructor() {
				super(instantiationService.get(ISharedProcessService), instantiationService.get(IRemoteAgentService));
			}
			get localExtensionManagementServer(): IExtensionManagementServer { return this._localExtensionManagementServer; }
			set localExtensionManagementServer(server: IExtensionManagementServer) { }
		}());

		instantiationService.stub(IExtensionEnablementService, new TestExtensionEnablementService(instantiationService));

		const reasons = {};
		reasons[workspaceRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[workspaceRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[fileBasedRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[fileBasedRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[otherRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Executable };
		instantiationService.stub(IExtensionTipsService, {
			getWorkspaceRecommendations: () => Promise.resolve([
				{ extensionId: workspaceRecommendationA.identifier.id, sources: [] },
				{ extensionId: workspaceRecommendationB.identifier.id, sources: [] }]),
			getFileBasedRecommendations: () => [
				{ extensionId: fileBasedRecommendationA.identifier.id, sources: [] },
				{ extensionId: fileBasedRecommendationB.identifier.id, sources: [] }],
			getOtherRecommendations: () => Promise.resolve([
				{ extensionId: otherRecommendationA.identifier.id, sources: [] }]),
			getAllRecommendationsWithReason: () => reasons
		});
		instantiationService.stub(IURLService, URLService);
	});

	setup(async () => {
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localEnabledTheme, localEnabledLanguage, localRandom, localDisabledTheme, localDisabledLanguage, builtInTheme, builtInBasic]);
		instantiationService.stubPromise(IExtensionManagementService, 'getExtensionsReport', []);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		instantiationService.stubPromise(IExperimentService, 'getExperimentsByType', []);

		instantiationService.stub(IExtensionService, {
			getExtensions: (): Promise<IExtensionDescription[]> => {
				return Promise.resolve([
					toExtensionDescription(localEnabledTheme),
					toExtensionDescription(localEnabledLanguage),
					toExtensionDescription(localRandom),
					toExtensionDescription(builtInTheme),
					toExtensionDescription(builtInBasic)
				]);
			}
		});
		await (<TestExtensionEnablementService>instantiationService.get(IExtensionEnablementService)).setEnablement([localDisabledTheme], EnablementState.Disabled);
		await (<TestExtensionEnablementService>instantiationService.get(IExtensionEnablementService)).setEnablement([localDisabledLanguage], EnablementState.Disabled);

		instantiationService.set(IExtensionsWorkbenchService, instantiationService.createInstance(ExtensionsWorkbenchService));
		testableView = instantiationService.createInstance(ExtensionsListView, {});
	});

	teardown(() => {
		(<ExtensionsWorkbenchService>instantiationService.get(IExtensionsWorkbenchService)).dispose();
		testableView.dispose();
	});

	test('Test query types', () => {
		assert.equal(ExtensionsListView.isBuiltInExtensionsQuery('@builtin'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@installed'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@enabled'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@disabled'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@outdated'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@installed searchText'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@enabled searchText'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@disabled searchText'), true);
		assert.equal(ExtensionsListView.isLocalExtensionsQuery('@outdated searchText'), true);
	});

	test('Test empty query equates to sort by install count', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.equal(options.sortBy, SortBy.InstallCount);
		});
	});

	test('Test non empty query without sort doesnt use sortBy', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('some extension').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.equal(options.sortBy, undefined);
		});
	});

	test('Test query with sort uses sortBy', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('some extension @sort:rating').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.equal(options.sortBy, SortBy.WeightedRating);
		});
	});

	test('Test installed query results', async () => {
		await testableView.show('@installed').then(result => {
			assert.equal(result.length, 5, 'Unexpected number of results for @installed query');
			const actual = [result.get(0).name, result.get(1).name, result.get(2).name, result.get(3).name, result.get(4).name].sort();
			const expected = [localDisabledTheme.manifest.name, localEnabledTheme.manifest.name, localRandom.manifest.name, localDisabledLanguage.manifest.name, localEnabledLanguage.manifest.name];
			for (let i = 0; i < result.length; i++) {
				assert.equal(actual[i], expected[i], 'Unexpected extension for @installed query.');
			}
		});

		await testableView.show('@installed first').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @installed query');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
			assert.equal(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
		});

		await testableView.show('@disabled').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @disabled query');
			assert.equal(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query.');
			assert.equal(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query.');
		});

		await testableView.show('@enabled').then(result => {
			assert.equal(result.length, 3, 'Unexpected number of results for @enabled query');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query.');
			assert.equal(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @enabled query.');
			assert.equal(result.get(2).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query.');
		});

		await testableView.show('@builtin:themes').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @builtin:themes query');
			assert.equal(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin:themes query.');
		});

		await testableView.show('@builtin:basics').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @builtin:basics query');
			assert.equal(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin:basics query.');
		});

		await testableView.show('@builtin').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @builtin query');
			assert.equal(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin query.');
			assert.equal(result.get(1).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});

		await testableView.show('@builtin my-theme').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @builtin query');
			assert.equal(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});
	});

	test('Test installed query with category', async () => {
		await testableView.show('@installed category:themes').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @installed query with category');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
			assert.equal(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
		});

		await testableView.show('@installed category:"themes"').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @installed query with quoted category');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
			assert.equal(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
		});

		await testableView.show('@installed category:"programming languages"').then(result => {
			assert.equal(result.length, 2, 'Unexpected number of results for @installed query with quoted category including space');
			assert.equal(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category including space.');
			assert.equal(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category inlcuding space.');
		});

		await testableView.show('@installed category:themes category:random').then(result => {
			assert.equal(result.length, 3, 'Unexpected number of results for @installed query with multiple category');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.equal(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.equal(result.get(2).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
		});

		await testableView.show('@enabled category:themes').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @enabled query with category');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with category.');
		});

		await testableView.show('@enabled category:"themes"').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @enabled query with quoted category');
			assert.equal(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with quoted category.');
		});

		await testableView.show('@enabled category:"programming languages"').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @enabled query with quoted category inlcuding space');
			assert.equal(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query with quoted category including space.');
		});

		await testableView.show('@disabled category:themes').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @disabled query with category');
			assert.equal(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with category.');
		});

		await testableView.show('@disabled category:"themes"').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @disabled query with quoted category');
			assert.equal(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with quoted category.');
		});

		await testableView.show('@disabled category:"programming languages"').then(result => {
			assert.equal(result.length, 1, 'Unexpected number of results for @disabled query with quoted category inlcuding space');
			assert.equal(result.get(0).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query with quoted category including space.');
		});
	});

	test('Test @recommended:workspace query', () => {
		const workspaceRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...workspaceRecommendedExtensions));

		return testableView.show('@recommended:workspace').then(result => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.equal(options.names!.length, workspaceRecommendedExtensions.length);
			assert.equal(result.length, workspaceRecommendedExtensions.length);
			for (let i = 0; i < workspaceRecommendedExtensions.length; i++) {
				assert.equal(options.names![i], workspaceRecommendedExtensions[i].identifier.id);
				assert.equal(result.get(i).identifier.id, workspaceRecommendedExtensions[i].identifier.id);
			}
		});
	});

	test('Test @recommended query', () => {
		const allRecommendedExtensions = [
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			otherRecommendationA
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...allRecommendedExtensions));

		return testableView.show('@recommended').then(result => {
			const options: IQueryOptions = target.args[0][0];

			assert.ok(target.calledOnce);
			assert.equal(options.names!.length, allRecommendedExtensions.length);
			assert.equal(result.length, allRecommendedExtensions.length);
			for (let i = 0; i < allRecommendedExtensions.length; i++) {
				assert.equal(options.names![i], allRecommendedExtensions[i].identifier.id);
				assert.equal(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
			}
		});
	});


	test('Test @recommended:all query', () => {
		const allRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			otherRecommendationA
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...allRecommendedExtensions));

		return testableView.show('@recommended:all').then(result => {
			const options: IQueryOptions = target.args[0][0];

			assert.ok(target.calledOnce);
			assert.equal(options.names!.length, allRecommendedExtensions.length);
			assert.equal(result.length, allRecommendedExtensions.length);
			for (let i = 0; i < allRecommendedExtensions.length; i++) {
				assert.equal(options.names![i], allRecommendedExtensions[i].identifier.id);
				assert.equal(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
			}
		});
	});

	test('Test curated list experiment', () => {
		const curatedList = [
			workspaceRecommendationA,
			fileBasedRecommendationA
		];
		const experimentTarget = <SinonStub>instantiationService.stubPromise(IExperimentService, 'getCuratedExtensionsList', curatedList.map(e => e.identifier.id));
		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...curatedList));

		return testableView.show('curated:mykey').then(result => {
			const curatedKey: string = experimentTarget.args[0][0];
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(experimentTarget.calledOnce);
			assert.ok(queryTarget.calledOnce);
			assert.equal(options.names!.length, curatedList.length);
			assert.equal(result.length, curatedList.length);
			for (let i = 0; i < curatedList.length; i++) {
				assert.equal(options.names![i], curatedList[i].identifier.id);
				assert.equal(result.get(i).identifier.id, curatedList[i].identifier.id);
			}
			assert.equal(curatedKey, 'mykey');
		});
	});

	test('Test search', () => {
		const searchText = 'search-me';
		const results = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...results));
		return testableView.show('search-me').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(queryTarget.calledOnce);
			assert.equal(options.text, searchText);
			assert.equal(result.length, results.length);
			for (let i = 0; i < results.length; i++) {
				assert.equal(result.get(i).identifier.id, results[i].identifier.id);
			}
		});
	});

	test('Test preferred search experiment', () => {
		const searchText = 'search-me';
		const actual = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		const expected = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			fileBasedRecommendationA,
			otherRecommendationA
		];

		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...actual));
		const experimentTarget = <SinonStub>instantiationService.stubPromise(IExperimentService, 'getExperimentsByType', [{
			id: 'someId',
			enabled: true,
			state: ExperimentState.Run,
			action: {
				type: ExperimentActionType.ExtensionSearchResults,
				properties: {
					searchText: 'search-me',
					preferredResults: [
						workspaceRecommendationA.identifier.id,
						'something-that-wasnt-in-first-page',
						workspaceRecommendationB.identifier.id
					]
				}
			}
		}]);

		testableView.dispose();
		testableView = instantiationService.createInstance(ExtensionsListView, {});

		return testableView.show('search-me').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(experimentTarget.calledOnce);
			assert.ok(queryTarget.calledOnce);
			assert.equal(options.text, searchText);
			assert.equal(result.length, expected.length);
			for (let i = 0; i < expected.length; i++) {
				assert.equal(result.get(i).identifier.id, expected[i].identifier.id);
			}
		});
	});

	test('Skip preferred search experiment when user defines sort order', () => {
		const searchText = 'search-me';
		const realResults = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];

		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...realResults));

		testableView.dispose();
		testableView = instantiationService.createInstance(ExtensionsListView, {});

		return testableView.show('search-me @sort:installs').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(queryTarget.calledOnce);
			assert.equal(options.text, searchText);
			assert.equal(result.length, realResults.length);
			for (let i = 0; i < realResults.length; i++) {
				assert.equal(result.get(i).identifier.id, realResults[i].identifier.id);
			}
		});
	});

	function aLocalExtension(name: string = 'someext', manifest: any = {}, properties: any = {}): ILocalExtension {
		manifest = assign({ name, publisher: 'pub', version: '1.0.0' }, manifest);
		properties = assign({
			type: ExtensionType.User,
			location: URI.file(`pub.${name}`),
			identifier: { id: getGalleryExtensionId(manifest.publisher, manifest.name), uuid: undefined },
			metadata: { id: getGalleryExtensionId(manifest.publisher, manifest.name), publisherId: manifest.publisher, publisherDisplayName: 'somename' }
		}, properties);
		return <ILocalExtension>Object.create({ manifest, ...properties });
	}

	function aGalleryExtension(name: string, properties: any = {}, galleryExtensionProperties: any = {}, assets: any = {}): IGalleryExtension {
		const galleryExtension = <IGalleryExtension>Object.create({});
		assign(galleryExtension, { name, publisher: 'pub', version: '1.0.0', properties: {}, assets: {} }, properties);
		assign(galleryExtension.properties, { dependencies: [] }, galleryExtensionProperties);
		assign(galleryExtension.assets, assets);
		galleryExtension.identifier = { id: getGalleryExtensionId(galleryExtension.publisher, galleryExtension.name), uuid: generateUuid() };
		return <IGalleryExtension>galleryExtension;
	}

	function aPage<T>(...objects: T[]): IPager<T> {
		return { firstPage: objects, total: objects.length, pageSize: objects.length, getPage: () => null! };
	}

	function toExtensionDescription(local: ILocalExtension): IExtensionDescription {
		return {
			identifier: new ExtensionIdentifier(local.identifier.id),
			isBuiltin: local.type === ExtensionType.System,
			isUnderDevelopment: false,
			extensionLocation: local.location,
			...local.manifest
		};
	}
});

