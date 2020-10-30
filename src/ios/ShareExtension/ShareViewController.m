#import <UIKit/UIKit.h>
#import <Social/Social.h>
#import "ShareViewController.h"
#import <MobileCoreServices/MobileCoreServices.h>

@interface ShareViewController : UIViewController {
    int _verbosityLevel;
    NSUserDefaults *_userDefaults;
    NSString *_backURL;

    //- (void)sendResults
}
@property (nonatomic) int verbosityLevel;
@property (nonatomic,retain) NSUserDefaults *userDefaults;
@property (nonatomic,retain) NSString *backURL;
@end

/*
 * Constants
 */

#define VERBOSITY_DEBUG  0
#define VERBOSITY_INFO  10
#define VERBOSITY_WARN  20
#define VERBOSITY_ERROR 30

@implementation ShareViewController

@synthesize verbosityLevel = _verbosityLevel;
@synthesize userDefaults = _userDefaults;
@synthesize backURL = _backURL;

- (void) log:(int)level message:(NSString*)message {
    if (level >= self.verbosityLevel) {
        NSLog(@"[ShareViewController.m]%@", message);
    }
}
- (void) debug:(NSString*)message { [self log:VERBOSITY_DEBUG message:message]; }
- (void) info:(NSString*)message { [self log:VERBOSITY_INFO message:message]; }
- (void) warn:(NSString*)message { [self log:VERBOSITY_WARN message:message]; }
- (void) error:(NSString*)message { [self log:VERBOSITY_ERROR message:message]; }

- (void) setup {
    self.userDefaults = [[NSUserDefaults alloc] initWithSuiteName:SHAREEXT_GROUP_IDENTIFIER];
    self.verbosityLevel = [self.userDefaults integerForKey:@"verbosityLevel"];
    [self debug:@"[setup]"];
}

- (BOOL) isContentValid {
    return YES;
}

- (NSArray*) configurationItems {
    // To add configuration options via table cells at the bottom of the sheet, return an array of SLComposeSheetConfigurationItem here.
    return @[];
}

- (void) viewDidLoad {
    [self setup];
    [self debug:@"[viewDidLoad]"];
}

- (void) viewDidAppear:(BOOL)animated {
    [self.view endEditing:YES];
    [self loadAttachments];
    [self debug:@"[viewDidAppear]"];
}

- (void) didSelectPost {
    [self debug:@"[didSelectPost]"];
}

- (void) openURL:(nonnull NSURL *)url {

    SEL selector = NSSelectorFromString(@"openURL:options:completionHandler:");

    UIResponder* responder = self;
    while ((responder = [responder nextResponder]) != nil) {
        NSLog(@"responder = %@", responder);
        if([responder respondsToSelector:selector] == true) {
            NSMethodSignature *methodSignature = [responder methodSignatureForSelector:selector];
            NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:methodSignature];

            // Arguments
            void (^completion)(BOOL success) = ^void(BOOL success) {
                NSLog(@"Completions block: %i", success);
            };
            if (@available(iOS 13.0, *)) {
                UISceneOpenExternalURLOptions * options = [[UISceneOpenExternalURLOptions alloc] init];
                options.universalLinksOnly = false;

                [invocation setTarget: responder];
                [invocation setSelector: selector];
                [invocation setArgument: &url atIndex: 2];
                [invocation setArgument: &options atIndex:3];
                [invocation setArgument: &completion atIndex: 4];
                [invocation invoke];
                break;
            } else {
                NSDictionary<NSString *, id> *options = [NSDictionary dictionary];

                [invocation setTarget: responder];
                [invocation setSelector: selector];
                [invocation setArgument: &url atIndex: 2];
                [invocation setArgument: &options atIndex:3];
                [invocation setArgument: &completion atIndex: 4];
                [invocation invoke];
                break;
            }
        }
    }
}

- (void) sendResults: (NSDictionary*)results {
    [self.userDefaults setObject:results forKey:@"shared"];
    [self.userDefaults synchronize];

    // Emit a URL that opens the cordova app
    NSString *url = [NSString stringWithFormat:@"%@://shared", SHAREEXT_URL_SCHEME];

    // Shut down the extension
    [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil];

    [self openURL:[NSURL URLWithString:url]];
}

- (void) loadAttachments {
    __block NSMutableArray *items = [[NSMutableArray alloc] init];
    __block NSDictionary *results = @{
                                      @"text": @"Example Text",
                                      @"backURL": self.backURL != nil ? self.backURL : @"",
                                      @"items": items,
                                      };

    NSExtensionItem *extensionItem = self.extensionContext.inputItems.firstObject;
    __block int remainingAttachments = extensionItem.attachments.count;

    NSString *urlUTI = (NSString*)kUTTypeURL;
    NSString *fileURLUTI = (NSString*)kUTTypeFileURL;
    NSString *plainTextUTI = (NSString*)kUTTypePlainText;
    NSString *dataUTI = (NSString*)kUTTypeData;

    for (NSItemProvider* itemProvider in extensionItem.attachments) {
        [self debug:[NSString stringWithFormat:@"item provider registered indentifiers = %@", itemProvider.registeredTypeIdentifiers]];

        // If the itme
        BOOL confromsToFileURL = [itemProvider hasItemConformingToTypeIdentifier:fileURLUTI];

        // Handle URLs but ignore file URLs
        if (confromsToFileURL == false && [itemProvider hasItemConformingToTypeIdentifier:urlUTI]) {
            [self debug:[NSString stringWithFormat:@"loading item as \"%@\"", urlUTI]];
            [itemProvider loadItemForTypeIdentifier:urlUTI options:nil completionHandler:^(NSURL* url, NSError* error) {
                --remainingAttachments;

                NSString *uti = urlUTI;
                if (itemProvider.registeredTypeIdentifiers.count > 0) {
                    uti = itemProvider.registeredTypeIdentifiers.firstObject;
                }

                NSDictionary *dict = @{
                                       @"text" : url.absoluteString,
                                       @"uti": uti,
                                       @"utis": itemProvider.registeredTypeIdentifiers,
                                       @"type": [self mimeTypeFromUti:uti],
                                       };

                [self debug:[NSString stringWithFormat:@"loaded item as \"%@\" = %@", urlUTI, dict]];

                [items addObject:dict];
                if (remainingAttachments == 0) {
                    [self sendResults:results];
                }
            }];
        }
        // Handle plain text, ignore file urls
        else if (confromsToFileURL == false && [itemProvider hasItemConformingToTypeIdentifier:plainTextUTI]) {
            [self debug:[NSString stringWithFormat:@"loading item as \"%@\"", plainTextUTI]];
            [itemProvider loadItemForTypeIdentifier:plainTextUTI options:nil completionHandler:^(NSString* text, NSError* error) {
                --remainingAttachments;

                NSString *uti = plainTextUTI;
                if (itemProvider.registeredTypeIdentifiers.count > 0) {
                    uti = itemProvider.registeredTypeIdentifiers.firstObject;
                }

                NSDictionary *dict = @{
                                       @"text" : text,
                                       @"uti": uti,
                                       @"utis": itemProvider.registeredTypeIdentifiers,
                                       @"type": [self mimeTypeFromUti:uti],
                                       };

                [self debug:[NSString stringWithFormat:@"loaded item as \"%@\" = %@", plainTextUTI, dict]];

                [items addObject:dict];
                if (remainingAttachments == 0) {
                    [self sendResults:results];
                }
            }];
        }
        // Handle any other data, it tries to load the file in place or copies it to tmp
        else if ([itemProvider hasItemConformingToTypeIdentifier:dataUTI]) {
            [self debug:[NSString stringWithFormat:@"loading file in place as \"%@\"", dataUTI]];
            [itemProvider loadInPlaceFileRepresentationForTypeIdentifier:dataUTI completionHandler:^(NSURL* fileUrl, BOOL isInPlace, NSError* error) {
                --remainingAttachments;

                NSString *uti = dataUTI;
                if (itemProvider.registeredTypeIdentifiers.count > 0) {
                    uti = itemProvider.registeredTypeIdentifiers.firstObject;
                }

                NSString *fileName = @"";
                if ([itemProvider respondsToSelector:NSSelectorFromString(@"getSuggestedName")]) {
                    fileName = [itemProvider valueForKey:@"suggestedName"];
                } else if (isInPlace) {
                    fileName = fileUrl.lastPathComponent;
                }

                // Copy the file to the shared cache folder so the cordova app has access to it.
                NSURL *containerUrl = [ [ NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier: SHAREEXT_GROUP_IDENTIFIER ];
                NSURL *sharedCacheUrl = [containerUrl URLByAppendingPathComponent: @"Library/Caches"];

                // Create a unique shared filename to avoid overwriting
                NSString *sharedFileName = [[[NSUUID UUID] UUIDString] stringByAppendingPathExtension:fileUrl.lastPathComponent];
                NSURL *sharedFileUrl = [sharedCacheUrl URLByAppendingPathComponent: sharedFileName];
                Boolean copiedSharedFile = [[NSFileManager defaultManager] copyItemAtURL:fileUrl toURL:sharedFileUrl error:nil];

                if (copiedSharedFile) {
                    NSDictionary *dict = @{
                                           @"uri" : sharedFileUrl.absoluteString,
                                           @"uti": uti,
                                           @"utis": itemProvider.registeredTypeIdentifiers,
                                           @"type": [self mimeTypeFromUti:uti],
                                           @"name": fileName,
                                           };

                    [self debug:[NSString stringWithFormat:@"loaded file in place as \"%@\" = %@", dataUTI, dict]];

                    [items addObject:dict];
                } else {
                    [self debug:[NSString stringWithFormat:@"failed to copy file \"%@\" to \"%@\"", fileUrl, sharedFileUrl]];
                }

                if (remainingAttachments == 0) {
                    [self sendResults:results];
                }
            }];
        }
        else {
            [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil];
        }
    }
}

- (NSString*) backURLFromBundleID: (NSString*)bundleId {
    return nil;
    if (bundleId == nil) return nil;
    // App Store - com.apple.AppStore
    if ([bundleId isEqualToString:@"com.apple.AppStore"]) return @"itms-apps://";
    // Calculator - com.apple.calculator
    // Calendar - com.apple.mobilecal
    // Camera - com.apple.camera
    // Clock - com.apple.mobiletimer
    // Compass - com.apple.compass
    // Contacts - com.apple.MobileAddressBook
    // FaceTime - com.apple.facetime
    // Find Friends - com.apple.mobileme.fmf1
    // Find iPhone - com.apple.mobileme.fmip1
    // Game Center - com.apple.gamecenter
    // Health - com.apple.Health
    // iBooks - com.apple.iBooks
    // iTunes Store - com.apple.MobileStore
    // Mail - com.apple.mobilemail - message://
    if ([bundleId isEqualToString:@"com.apple.mobilemail"]) return @"message://";
    // Maps - com.apple.Maps - maps://
    if ([bundleId isEqualToString:@"com.apple.Maps"]) return @"maps://";
    // Messages - com.apple.MobileSMS
    // Music - com.apple.Music
    // News - com.apple.news - applenews://
    if ([bundleId isEqualToString:@"com.apple.news"]) return @"applenews://";
    // Notes - com.apple.mobilenotes - mobilenotes://
    if ([bundleId isEqualToString:@"com.apple.mobilenotes"]) return @"mobilenotes://";
    // Phone - com.apple.mobilephone
    // Photos - com.apple.mobileslideshow
    if ([bundleId isEqualToString:@"com.apple.mobileslideshow"]) return @"photos-redirect://";
    // Podcasts - com.apple.podcasts
    // Reminders - com.apple.reminders - x-apple-reminder://
    if ([bundleId isEqualToString:@"com.apple.reminders"]) return @"x-apple-reminder://";
    // Safari - com.apple.mobilesafari
    // Settings - com.apple.Preferences
    // Stocks - com.apple.stocks
    // Tips - com.apple.tips
    // Videos - com.apple.videos - videos://
    if ([bundleId isEqualToString:@"com.apple.videos"]) return @"videos://";
    // Voice Memos - com.apple.VoiceMemos - voicememos://
    if ([bundleId isEqualToString:@"com.apple.VoiceMemos"]) return @"voicememos://";
    // Wallet - com.apple.Passbook
    // Watch - com.apple.Bridge
    // Weather - com.apple.weather
    return nil;
}

// This is called at the point where the Post dialog is about to be shown.
// We use it to store the _hostBundleID
- (void) willMoveToParentViewController: (UIViewController*)parent {
    NSString *hostBundleID = [parent valueForKey:(@"_hostBundleID")];
    self.backURL = [self backURLFromBundleID:hostBundleID];
}


- (NSString *)mimeTypeFromUti: (NSString*)uti {
    if (uti == nil) {
        return @"";
    }
    CFStringRef cret = UTTypeCopyPreferredTagWithClass((__bridge CFStringRef)uti, kUTTagClassMIMEType);
    NSString *ret = (__bridge_transfer NSString *)cret;
    return ret == nil ? @"" : ret;
}

@end
