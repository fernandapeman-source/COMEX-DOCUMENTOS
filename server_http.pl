#!/usr/bin/perl
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
use Cwd qw(getcwd);

my $cwd  = getcwd();
my $ROOT = (grep { -d $_ } ("$cwd/public", "public"))[0] // "public";
my $PORT = $ENV{PORT} // 3000;

my %MIME = (
    html => 'text/html; charset=utf-8',
    css  => 'text/css; charset=utf-8',
    js   => 'application/javascript; charset=utf-8',
    json => 'application/json; charset=utf-8',
    png  => 'image/png',
    ico  => 'image/x-icon',
    xlsx => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);

my $server = IO::Socket::INET->new(
    LocalPort => $PORT,
    Type      => SOCK_STREAM,
    Reuse     => 1,
    Listen    => 50,
) or die "Cannot bind to port $PORT: $!\n";

$server->blocking(0);
$| = 1;
print "PEMAN Comex App: http://localhost:$PORT\n";

my $sel     = IO::Select->new($server);
my %buffers;   # socket -> accumulated request headers

while (1) {
    my @ready = $sel->can_read(1);
    for my $fh (@ready) {
        if ($fh == $server) {
            # New incoming connection
            my $client = $server->accept();
            next unless $client;
            $client->blocking(0);
            $sel->add($client);
            $buffers{$client} = '';
        } else {
            # Read data from existing connection
            my $chunk;
            my $n = sysread($fh, $chunk, 8192);
            if (!defined $n || $n == 0) {
                $sel->remove($fh);
                delete $buffers{$fh};
                close $fh;
                next;
            }
            $buffers{$fh} .= $chunk;
            # Check if we have a complete HTTP request (headers end with \r\n\r\n)
            if ($buffers{$fh} =~ /\r\n\r\n/) {
                handle($fh, $buffers{$fh});
                $sel->remove($fh);
                delete $buffers{$fh};
                close $fh;
            }
        }
    }
}

sub write_all {
    my ($fh, $data) = @_;
    $fh->blocking(1);
    my $total = length($data);
    my $sent  = 0;
    while ($sent < $total) {
        my $n = syswrite($fh, $data, $total - $sent, $sent);
        last unless defined $n && $n > 0;
        $sent += $n;
    }
}

sub handle {
    my ($client, $req) = @_;
    my ($path) = $req =~ /^GET\s+(\S+)/;
    $path //= '/';
    $path =~ s/\?.*//;
    $path = '/index.html' if $path eq '/';

    my $file = "$ROOT$path";
    if (-f $file) {
        my ($ext) = $file =~ /\.([^.]+)$/;
        my $mime = $MIME{lc($ext // '')} // 'application/octet-stream';
        open(my $fh, '<:raw', $file) or do {
            write_all($client, "HTTP/1.1 500 Error\r\nConnection: close\r\n\r\n");
            return;
        };
        local $/;
        my $body = <$fh>;
        close $fh;
        my $hdr = "HTTP/1.1 200 OK\r\nContent-Type: $mime\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n";
        write_all($client, $hdr . $body);
    } else {
        write_all($client, "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n404 Not Found: $path");
    }
}
