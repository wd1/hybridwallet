import { Component, NgZone, ViewChild } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Events, NavController, Platform } from 'ionic-angular';
import * as _ from 'lodash';
import * as moment from 'moment';
import { Observable, Subscription } from 'rxjs';

// Pages
import { AddPage } from '../add/add';
import { BitPayCardPage } from '../integrations/bitpay-card/bitpay-card';
import { BitPayCardIntroPage } from '../integrations/bitpay-card/bitpay-card-intro/bitpay-card-intro';
import { CoinbasePage } from '../integrations/coinbase/coinbase';
import { ShapeshiftPage } from '../integrations/shapeshift/shapeshift';
import { ProposalsPage } from './proposals/proposals';

// Providers
import { AppProvider } from '../../providers/app/app';
import { BitPayCardProvider } from '../../providers/bitpay-card/bitpay-card';
import { BwcErrorProvider } from '../../providers/bwc-error/bwc-error';
import { ClipboardProvider } from '../../providers/clipboard/clipboard';
import { EmailNotificationsProvider } from '../../providers/email-notifications/email-notifications';
import { ExternalLinkProvider } from '../../providers/external-link/external-link';
import { FeedbackProvider } from '../../providers/feedback/feedback';
import { HomeIntegrationsProvider } from '../../providers/home-integrations/home-integrations';
import { IncomingDataProvider } from '../../providers/incoming-data/incoming-data';
import { Logger } from '../../providers/logger/logger';
import { PersistenceProvider } from '../../providers/persistence/persistence';
import { PlatformProvider } from '../../providers/platform/platform';
import { PopupProvider } from '../../providers/popup/popup';
import { ProfileProvider } from '../../providers/profile/profile';
import { Coin, WalletProvider } from '../../providers/wallet/wallet';
import { SettingsPage } from '../settings/settings';

interface UpdateWalletOptsI {
  walletId: string;
  force?: boolean;
  alsoUpdateHistory?: boolean;
}

@Component({
  selector: 'page-home',
  templateUrl: 'home.html'
})
export class HomePage {
  @ViewChild('showCard')
  showCard;
  public vault;
  public vaultWallets;
  public wallets;
  public walletsBtc;
  public walletsBch;
  public txpsN: number;
  public serverMessages: any[];
  public homeIntegrations;
  public bitpayCardItems;
  public showBitPayCard: boolean = false;
  public showAnnouncement: boolean = false;
  public validDataFromClipboard;
  public payProDetailsData;
  public remainingTimeStr: string;
  public slideDown: boolean;

  public showRateCard: boolean;
  public showReorderBtc: boolean;
  public showReorderBch: boolean;
  public showReorderVaultWallets: boolean;
  public showIntegration;
  public hideHomeIntegrations: boolean;
  public showGiftCards: boolean;
  public showBitpayCardGetStarted: boolean;
  public accessDenied: boolean;

  private isElectron: boolean;
  private zone;
  private countDown;
  private onResumeSubscription: Subscription;
  private onPauseSubscription: Subscription;

  constructor(
    private plt: Platform,
    private navCtrl: NavController,
    private profileProvider: ProfileProvider,
    private walletProvider: WalletProvider,
    private bwcErrorProvider: BwcErrorProvider,
    private logger: Logger,
    private events: Events,
    private externalLinkProvider: ExternalLinkProvider,
    private popupProvider: PopupProvider,
    private appProvider: AppProvider,
    private platformProvider: PlatformProvider,
    private homeIntegrationsProvider: HomeIntegrationsProvider,
    private persistenceProvider: PersistenceProvider,
    private feedbackProvider: FeedbackProvider,
    private bitPayCardProvider: BitPayCardProvider,
    private translate: TranslateService,
    private emailProvider: EmailNotificationsProvider,
    private clipboardProvider: ClipboardProvider,
    private incomingDataProvider: IncomingDataProvider
  ) {
    this.slideDown = false;
    this.isElectron = this.platformProvider.isElectron;
    this.showReorderBtc = false;
    this.showReorderBch = false;
    this.showReorderVaultWallets = false;
    this.zone = new NgZone({ enableLongStackTrace: false });
    this.events.subscribe('Home/reloadStatus', () => {
      this._willEnter();
      this._didEnter();
    });
  }

  ionViewWillEnter() {
    this._willEnter();
  }

  ionViewDidEnter() {
    this._didEnter();
  }

  private _willEnter() {
    // Update list of wallets, status and TXPs
    this.setWallets();

    // Update Wallet on Focus
    if (this.isElectron) {
      this.updateDesktopOnFocus();
    }
  }

  private _didEnter() {
    this.checkClipboard();

    // Show integrations
    const integrations = _.filter(this.homeIntegrationsProvider.get(), {
      show: true
    }).filter(i => i.name !== 'giftcards' && i.name !== 'debitcard');

    this.showGiftCards = this.homeIntegrationsProvider.shouldShowInHome(
      'giftcards'
    );

    this.showBitpayCardGetStarted = this.homeIntegrationsProvider.shouldShowInHome(
      'debitcard'
    );

    // Hide BitPay if linked
    setTimeout(() => {
      this.homeIntegrations = _.remove(_.clone(integrations), x => {
        if (x.name == 'debitcard' && x.linked) return;
        else return x;
      });
    }, 200);

    // Only BitPay Wallet
    this.bitPayCardProvider.get({}, (_, cards) => {
      this.zone.run(() => {
        this.showBitPayCard = this.appProvider.info._enabledExtensions.debitcard
          ? true
          : false;
        this.bitpayCardItems = cards;
      });
    });
  }

  private walletFocusHandler = opts => {
    this.logger.debug('RECV Local/WalletFocus @home', opts);
    opts = opts || {};
    opts.alsoUpdateHistory = true;
    this.fetchWalletStatus(opts);
  };

  ionViewDidLoad() {
    this.logger.info('Loaded: HomePage');

    this.checkFeedbackInfo();

    this.checkEmailLawCompliance();

    const subscribeEvents = () => {
      // BWS Events: Update Status per Wallet -> Update txps
      // NewBlock, NewCopayer, NewAddress, NewTxProposal, TxProposalAcceptedBy, TxProposalRejectedBy, txProposalFinallyRejected,
      // txProposalFinallyAccepted, TxProposalRemoved, NewIncomingTx, NewOutgoingTx
      this.events.subscribe('bwsEvent', this.bwsEventHandler);

      // Create, Join, Import and Delete -> Get Wallets -> Update Status for All Wallets -> Update txps
      this.events.subscribe('Local/WalletListChange', this.setWallets);

      // Reject, Remove, OnlyPublish and SignAndBroadcast -> Update Status per Wallet -> Update txps
      this.events.subscribe('Local/TxAction', this.walletFocusHandler);

      // Wallet is focused on some inner view, therefore, we refresh its status and txs
      this.events.subscribe('Local/WalletFocus', this.walletFocusHandler);
    };

    subscribeEvents();
    this.onResumeSubscription = this.plt.resume.subscribe(() => {
      this.setWallets();
      this.checkClipboard();
      subscribeEvents();
    });

    this.onPauseSubscription = this.plt.pause.subscribe(() => {
      this.events.unsubscribe('bwsEvent', this.bwsEventHandler);
      this.events.unsubscribe('Local/WalletListChange', this.setWallets);
      this.events.unsubscribe('Local/TxAction', this.walletFocusHandler);
      this.events.unsubscribe('Local/WalletFocus', this.walletFocusHandler);
    });
    this.setWallets(true);
  }

  ngOnDestroy() {
    this.onResumeSubscription.unsubscribe();
    this.onPauseSubscription.unsubscribe();
  }

  ionViewWillLeave() {
    this.resetValuesForAnimationCard();
  }

  private async resetValuesForAnimationCard() {
    await Observable.timer(50).toPromise();
    this.validDataFromClipboard = null;
    this.slideDown = false;
  }

  private debounceFetchWalletStatus = _.debounce(
    async (walletId, alsoUpdateHistory) => {
      this.fetchWalletStatus({ walletId, alsoUpdateHistory });
    },
    3000
  );

  // BWS events can come many at time (publish,sign, broadcast...)
  private bwsEventHandler = (walletId, type, n) => {
    // NewBlock, NewCopayer, NewAddress, NewTxProposal, TxProposalAcceptedBy, TxProposalRejectedBy, txProposalFinallyRejected,
    // txProposalFinallyAccepted, TxProposalRemoved, NewIncomingTx, NewOutgoingTx

    const wallet = this.profileProvider.getWallet(walletId);
    if (wallet.copayerId == n.creatorId) {
      return;
    }

    this.logger.info(`BWS Event: ${type}: `, n);

    let alsoUpdateHistory = false;
    switch (type) {
      case 'NewAddress':
        this.walletProvider.expireAddress(walletId);
        return;
      case 'NewIncomingTx':
      case 'NewOutgoingTx':
      case 'NewBlock':
        alsoUpdateHistory = true;
    }
    this.walletProvider.invalidateCache(wallet);
    this.debounceFetchWalletStatus(walletId, alsoUpdateHistory);
  };

  private updateDesktopOnFocus() {
    const { remote } = (window as any).require('electron');
    const win = remote.getCurrentWindow();
    win.on('focus', () => {
      this.checkClipboard();
      this.setWallets();
    });
  }

  private openEmailDisclaimer() {
    const message = this.translate.instant(
      'By providing your email address, you give explicit consent to BitPay to use your email address to send you email notifications about payments.'
    );
    const title = this.translate.instant('Privacy Policy update');
    const okText = this.translate.instant('Accept');
    const cancelText = this.translate.instant('Disable notifications');
    this.popupProvider
      .ionicConfirm(title, message, okText, cancelText)
      .then(ok => {
        if (ok) {
          // Accept new Privacy Policy
          this.persistenceProvider.setEmailLawCompliance('accepted');
        } else {
          // Disable email notifications
          this.persistenceProvider.setEmailLawCompliance('rejected');
          this.emailProvider.updateEmail({
            enabled: false,
            email: 'null@email'
          });
        }
      });
  }

  private checkEmailLawCompliance(): void {
    setTimeout(() => {
      if (this.emailProvider.getEmailIfEnabled()) {
        this.persistenceProvider.getEmailLawCompliance().then(value => {
          if (!value) this.openEmailDisclaimer();
        });
      }
    }, 2000);
  }

  private debounceSetWallets = _.debounce(
    async () => {
      this.setWallets(true);
    },
    5000,
    {
      leading: true
    }
  );

  private setWallets = (shouldUpdate: boolean = false) => {
    // TEST
    /* 
    setTimeout(() => {
      this.logger.info('##### Load BITCOIN URI TEST');
      this.incomingDataProvider.redir('bitcoin:3KeJU7VxSKC451pPNSWjF6zK3gm2x7re7q?amount=0.0001');
    },100);
    */

    this.profileProvider.setLastKnownBalance();
    this.wallets = this.profileProvider.getWallets();
    this.vaultWallets = this.profileProvider.getVaultWallets();
    this.walletsBtc = _.filter(this.wallets, (x: any) => {
      return (
        x.credentials.coin == 'btc' &&
        !this.profileProvider.vaultHasWallet(x.credentials.walletId)
      );
    });
    this.walletsBch = _.filter(this.wallets, (x: any) => {
      return (
        x.credentials.coin == 'bch' &&
        !this.profileProvider.vaultHasWallet(x.credentials.walletId)
      );
    });
    // Avoid heavy tasks that can slow down the unlocking experience
    if (!this.appProvider.isLockModalOpen && shouldUpdate) {
      this.fetchAllWalletsStatus();
    }
  };

  private checkFeedbackInfo() {
    this.persistenceProvider.getFeedbackInfo().then(info => {
      if (!info) {
        this.initFeedBackInfo();
      } else {
        const feedbackInfo = info;
        // Check if current version is greater than saved version
        const currentVersion = this.appProvider.info.version;
        const savedVersion = feedbackInfo.version;
        const isVersionUpdated = this.feedbackProvider.isVersionUpdated(
          currentVersion,
          savedVersion
        );
        if (!isVersionUpdated) {
          this.initFeedBackInfo();
          return;
        }
        const now = moment().unix();
        const timeExceeded = now - feedbackInfo.time >= 24 * 7 * 60 * 60;
        this.showRateCard = timeExceeded && !feedbackInfo.sent;
        this.showCard.setShowRateCard(this.showRateCard);
      }
    });
  }

  public checkClipboard() {
    return this.clipboardProvider
      .getData()
      .then(async data => {
        this.validDataFromClipboard = this.incomingDataProvider.parseData(data);
        if (!this.validDataFromClipboard) {
          return;
        }
        const dataToIgnore = [
          'BitcoinAddress',
          'BitcoinCashAddress',
          'PlainUrl'
        ];
        if (dataToIgnore.indexOf(this.validDataFromClipboard.type) > -1) {
          this.validDataFromClipboard = null;
          return;
        }
        if (this.validDataFromClipboard.type === 'PayPro') {
          const coin: string =
            data.indexOf('bitcoincash') === 0 ? Coin.BCH : Coin.BTC;
          this.incomingDataProvider
            .getPayProDetails(data)
            .then(payProDetails => {
              if (!payProDetails) {
                throw this.translate.instant('No wallets available');
              }
              this.payProDetailsData = payProDetails;
              this.payProDetailsData.host = new URL(
                payProDetails.payProUrl
              ).host;
              this.payProDetailsData.coin = coin;
              this.clearCountDownInterval();
              this.paymentTimeControl(this.payProDetailsData.expires);
            })
            .catch(err => {
              this.payProDetailsData = {};
              this.payProDetailsData.error = err;
              this.logger.warn('Error in Payment Protocol', err);
            });
        }
        await Observable.timer(50).toPromise();
        this.slideDown = true;
      })
      .catch(() => {
        this.logger.warn('Paste from clipboard err');
      });
  }

  public hideClipboardCard() {
    this.validDataFromClipboard = null;
    this.clipboardProvider.clear();
    this.slideDown = false;
  }

  public processClipboardData(data): void {
    this.clearCountDownInterval();
    this.incomingDataProvider.redir(data, { fromHomeCard: true });
  }

  private clearCountDownInterval(): void {
    if (this.countDown) clearInterval(this.countDown);
  }

  private paymentTimeControl(expires): void {
    const expirationTime = Math.floor(new Date(expires).getTime() / 1000);
    const setExpirationTime = (): void => {
      const now = Math.floor(Date.now() / 1000);
      if (now > expirationTime) {
        this.remainingTimeStr = this.translate.instant('Expired');
        this.clearCountDownInterval();
        return;
      }
      const totalSecs = expirationTime - now;
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      this.remainingTimeStr = ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
    };

    setExpirationTime();

    this.countDown = setInterval(() => {
      setExpirationTime();
    }, 1000);
  }

  private initFeedBackInfo() {
    this.persistenceProvider.setFeedbackInfo({
      time: moment().unix(),
      version: this.appProvider.info.version,
      sent: false
    });
    this.showRateCard = false;
  }

  private fetchTxHistory(opts: UpdateWalletOptsI) {
    if (!opts.walletId) {
      this.logger.error('Error no walletId in update History');
      return;
    }
    const wallet = this.profileProvider.getWallet(opts.walletId);

    const progressFn = ((_, newTxs) => {
      let args = {
        walletId: opts.walletId,
        finished: false,
        progress: newTxs
      };
      this.events.publish('Local/WalletHistoryUpdate', args);
    }).bind(this);

    // Fire a startup event, to allow UI to show the spinner
    this.events.publish('Local/WalletHistoryUpdate', {
      walletId: opts.walletId,
      finished: false
    });
    this.walletProvider
      .fetchTxHistory(wallet, progressFn, opts)
      .then(txHistory => {
        wallet.completeHistory = txHistory;
        this.events.publish('Local/WalletHistoryUpdate', {
          walletId: opts.walletId,
          finished: true
        });
      })
      .catch(err => {
        if (err != 'HISTORY_IN_PROGRESS') {
          this.logger.warn('WalletHistoryUpdate ERROR', err);
          this.events.publish('Local/WalletHistoryUpdate', {
            walletId: opts.walletId,
            finished: false,
            error: err
          });
        }
      });
  }

  // Names:
  // .fetch => from BWS
  // .update => to UI
  /* This is the only .getStatus call in Copay */
  private fetchWalletStatus = (opts: UpdateWalletOptsI): void => {
    if (!opts.walletId) {
      this.logger.error('Error no walletId in update Wallet');
      return;
    }
    this.events.publish('Local/WalletUpdate', {
      walletId: opts.walletId,
      finished: false
    });

    this.logger.debug(
      'fetching status for: ' +
        opts.walletId +
        ' alsohistory:' +
        opts.alsoUpdateHistory
    );
    const wallet = this.profileProvider.getWallet(opts.walletId);
    if (!wallet) return;

    this.walletProvider
      .fetchStatus(wallet, opts)
      .then(status => {
        wallet.cachedStatus = status;
        wallet.error = wallet.errorObj = null;

        this.persistenceProvider.setLastKnownBalance(
          wallet.id,
          wallet.cachedStatus.availableBalanceStr
        );

        // Update txps
        this.updateTxps();
        this.events.publish('Local/WalletUpdate', {
          walletId: opts.walletId,
          finished: true
        });

        if (opts.alsoUpdateHistory) {
          this.fetchTxHistory({ walletId: opts.walletId });
        }
      })
      .catch(err => {
        this.processWalletError(wallet, err);

        this.events.publish('Local/WalletUpdate', {
          walletId: opts.walletId,
          finished: false,
          error: wallet.error
        });

        if (opts.alsoUpdateHistory) {
          this.fetchTxHistory({ walletId: opts.walletId });
        }
      });
  };

  private updateTxps() {
    this.profileProvider
      .getTxps({ limit: 3 })
      .then(data => {
        this.zone.run(() => {
          this.txpsN = data.n;
        });
      })
      .catch(err => {
        this.logger.error(err);
      });
  }

  private fetchAllWalletsStatus(): void {
    let foundMessage = false;

    if (_.isEmpty(this.wallets)) return;

    this.logger.debug('fetchAllWalletsStatus');
    const pr = wallet => {
      return this.walletProvider
        .fetchStatus(wallet, {})
        .then(async status => {
          wallet.cachedStatus = status;
          wallet.error = wallet.errorObj = null;

          if (!foundMessage && !_.isEmpty(status.serverMessages)) {
            this.serverMessages = _.orderBy(
              status.serverMessages,
              ['priority'],
              ['asc']
            );
            this.serverMessages.forEach(serverMessage => {
              this.checkServerMessage(serverMessage);
            });
            foundMessage = true;
          }

          this.persistenceProvider.setLastKnownBalance(
            wallet.id,
            wallet.cachedStatus.availableBalanceStr
          );
          return Promise.resolve();
        })
        .catch(err => {
          this.processWalletError(wallet, err);
          return Promise.resolve();
        });
    };

    const promises = [];

    _.each(this.wallets, wallet => {
      promises.push(pr(wallet));
    });

    Promise.all(promises).then(() => {
      this.updateTxps();
    });
  }

  private processWalletError(wallet, err): void {
    wallet.error = wallet.errorObj = null;

    if (!err || err == 'INPROGRESS') return;

    wallet.cachedStatus = null;
    wallet.errorObj = err;

    if (err.message === '403') {
      this.accessDenied = true;
      wallet.error = this.translate.instant('Access denied');
    } else if (err === 'WALLET_NOT_REGISTERED') {
      wallet.error = this.translate.instant('Wallet not registered');
    } else {
      wallet.error = this.bwcErrorProvider.msg(err);
    }
    this.logger.warn(
      this.bwcErrorProvider.msg(
        wallet.error,
        'Error updating status for ' + wallet.id
      )
    );
  }

  private removeServerMessage(id): void {
    this.serverMessages = _.filter(this.serverMessages, s => s.id !== id);
  }

  public dismissServerMessage(serverMessage): void {
    this.logger.debug(`Server message id: ${serverMessage.id} dismissed`);
    this.persistenceProvider.setServerMessageDismissed(serverMessage.id);
    this.removeServerMessage(serverMessage.id);
  }

  public checkServerMessage(serverMessage): void {
    if (serverMessage.app && serverMessage.app != this.appProvider.info.name) {
      this.removeServerMessage(serverMessage.id);
      return;
    }

    if (
      serverMessage.id === 'bcard-atm' &&
      (!this.showBitPayCard ||
        !this.bitpayCardItems ||
        !this.bitpayCardItems[0])
    ) {
      this.removeServerMessage(serverMessage.id);
      return;
    }

    this.persistenceProvider
      .getServerMessageDismissed(serverMessage.id)
      .then((value: string) => {
        if (value === 'dismissed') {
          this.removeServerMessage(serverMessage.id);
        }
      });
  }

  public openServerMessageLink(url): void {
    this.externalLinkProvider.open(url);
  }

  public openCountryBannedLink(): void {
    const url =
      "https://github.com/bitpay/copay/wiki/Why-can't-I-use-BitPay's-services-in-my-country%3F";
    this.externalLinkProvider.open(url);
  }

  public goToAddView(): void {
    this.navCtrl.push(AddPage);
  }

  public goToWalletDetails(wallet): void {
    if (
      this.showReorderBtc ||
      this.showReorderBch ||
      this.showReorderVaultWallets
    )
      return;

    this.events.publish('OpenWallet', wallet);
  }

  public reorderBtc(): void {
    this.showReorderBtc = !this.showReorderBtc;
  }

  public reorderBch(): void {
    this.showReorderBch = !this.showReorderBch;
  }

  public reorderVault(): void {
    this.showReorderVaultWallets = !this.showReorderVaultWallets;
  }

  public reorderWalletsBtc(indexes): void {
    const element = this.walletsBtc[indexes.from];
    this.walletsBtc.splice(indexes.from, 1);
    this.walletsBtc.splice(indexes.to, 0, element);
    _.each(this.walletsBtc, (wallet, index: number) => {
      this.profileProvider.setWalletOrder(wallet.id, index);
    });
  }

  public reorderWalletsBch(indexes): void {
    const element = this.walletsBch[indexes.from];
    this.walletsBch.splice(indexes.from, 1);
    this.walletsBch.splice(indexes.to, 0, element);
    _.each(this.walletsBch, (wallet, index: number) => {
      this.profileProvider.setWalletOrder(wallet.id, index);
    });
  }

  public reorderVaultWallets(indexes): void {
    const element = this.vaultWallets[indexes.from];
    this.vaultWallets.splice(indexes.from, 1);
    this.vaultWallets.splice(indexes.to, 0, element);
    _.each(this.vaultWallets, (wallet, index: number) => {
      this.profileProvider.setWalletOrder(wallet.id, index);
    });
  }

  public openProposalsPage(): void {
    this.navCtrl.push(ProposalsPage);
  }

  public goTo(page: string): void {
    const pageMap = {
      BitPayCardIntroPage,
      CoinbasePage,
      ShapeshiftPage
    };
    this.navCtrl.push(pageMap[page]);
  }

  public goToCard(cardId): void {
    this.navCtrl.push(BitPayCardPage, { id: cardId });
  }

  public doRefresh(refresher): void {
    this.debounceSetWallets();
    setTimeout(() => {
      refresher.complete();
    }, 2000);
  }

  public scan(): void {
    this.navCtrl.parent.select(1);
  }

  public settings(): void {
    this.navCtrl.push(SettingsPage);
  }
}
